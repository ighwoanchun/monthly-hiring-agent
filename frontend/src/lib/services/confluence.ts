/**
 * Confluence 업로드 서비스 — Python confluence_service.py 포팅
 */

import { marked } from "marked";

function headers(): Record<string, string> {
  const email = process.env.CONFLUENCE_EMAIL || "";
  const token = process.env.CONFLUENCE_TOKEN || "";
  const cred = Buffer.from(`${email}:${token}`).toString("base64");
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Basic ${cred}`,
  };
}

function baseUrl(): string {
  return (process.env.CONFLUENCE_URL || "").replace(/\/$/, "");
}

/**
 * 마크다운 → Confluence storage format 변환.
 * Fabric editor 호환을 위해 매크로/인라인 style 없이 기본 HTML만 사용.
 */
export function convertMarkdownToConfluence(mdText: string): string {
  let html = marked.parse(mdText, { async: false, gfm: true }) as string;

  // 코드 블록: <pre><code> 유지 (Confluence가 기본 지원)
  html = html.replace(
    /<pre><code(?:\s+class="language-(\w+)")?\s*>(.*?)<\/code><\/pre>/gs,
    (_, _lang, code) => `<pre>${code}</pre>`,
  );

  // XHTML self-closing 태그
  html = html.replace(/<hr\s*\/?>/g, "<hr />");
  html = html.replace(/<br\s*\/?>/g, "<br />");
  html = html.replace(/<img([^>]*?)(?<!\/)>/g, "<img$1 />");

  // Confluence 미지원 HTML 태그 제거 (내용만 유지)
  html = html.replace(/<del>(.*?)<\/del>/gs, "$1");
  html = html.replace(/<ins>(.*?)<\/ins>/gs, "$1");
  html = html.replace(/<details[^>]*>(.*?)<\/details>/gs, "$1");
  html = html.replace(/<summary[^>]*>(.*?)<\/summary>/gs, "<strong>$1</strong>");
  html = html.replace(/<input[^>]*\/?>/g, "");

  // 이모지 variation selector 제거
  html = html.replace(/[\ufe0f\ufe0e\u200d]/g, "");

  // 제어 문자 제거
  // eslint-disable-next-line no-control-regex
  html = html.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

  // 서로게이트 쌍 깨짐 제거
  // eslint-disable-next-line no-misleading-character-class
  html = html.replace(/[\uD800-\uDFFF]/g, "");

  return html;
}

async function verifyAuth(): Promise<void> {
  const url = `${baseUrl()}/wiki/rest/api/user/current`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Confluence 인증 확인 실패: ${res.status}`);
  const data = await res.json();
  if (data.type === "anonymous")
    throw new Error("Confluence 인증 실패: Anonymous로 인식됨. CONFLUENCE_EMAIL과 CONFLUENCE_TOKEN을 확인하세요.");
}

async function resolveSpaceKey(): Promise<string> {
  const key = process.env.CONFLUENCE_SPACE_KEY || "";
  if (!key) throw new Error("CONFLUENCE_SPACE_KEY가 설정되지 않았습니다.");

  // v1 API 시도
  const url = `${baseUrl()}/wiki/rest/api/space/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: headers() });
  if (res.ok) return (await res.json()).key;

  // 숫자면 v2 API로 ID 기반 조회
  if (/^\d+$/.test(key)) {
    const res2 = await fetch(`${baseUrl()}/wiki/api/v2/spaces/${key}`, { headers: headers() });
    if (res2.ok) return (await res2.json()).key;
  }

  throw new Error(`Space '${key}'를 찾을 수 없습니다.`);
}

async function findPage(title: string, spaceKey: string): Promise<{ id: string; version: { number: number } } | null> {
  const url = `${baseUrl()}/wiki/rest/api/content?title=${encodeURIComponent(title)}&spaceKey=${spaceKey}&expand=version`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return null;
  const data = await res.json();
  return data.results?.[0] || null;
}

export async function uploadToConfluence(
  title: string,
  bodyHtml: string,
): Promise<{ page_id: string; page_url: string }> {
  await verifyAuth();
  const spaceKey = await resolveSpaceKey();
  const existing = await findPage(title, spaceKey);

  let url: string;
  let method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any;

  if (existing) {
    const version = existing.version.number;
    url = `${baseUrl()}/wiki/rest/api/content/${existing.id}`;
    method = "PUT";
    payload = {
      type: "page",
      title,
      space: { key: spaceKey },
      body: { storage: { value: bodyHtml, representation: "storage" } },
      version: { number: version + 1 },
    };
  } else {
    url = `${baseUrl()}/wiki/rest/api/content`;
    method = "POST";
    payload = {
      type: "page",
      title,
      space: { key: spaceKey },
      body: { storage: { value: bodyHtml, representation: "storage" } },
    };
    const parentId = process.env.CONFLUENCE_PARENT_ID;
    if (parentId) payload.ancestors = [{ id: parentId }];
  }

  const res = await fetch(url, {
    method,
    headers: headers(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Confluence 페이지 생성/수정 실패: ${res.status}. ${body.slice(0, 1000)}`);
  }

  const result = await res.json();
  return {
    page_id: result.id,
    page_url: `${baseUrl()}/wiki${result._links?.webui || ""}`,
  };
}
