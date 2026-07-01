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

function macro(name: string, body: string, params: Record<string, string> = {}): string {
  const paramStr = Object.entries(params)
    .map(([k, v]) => `<ac:parameter ac:name="${k}">${v}</ac:parameter>`)
    .join("");
  return `<ac:structured-macro ac:name="${name}">${paramStr}<ac:rich-text-body>${body}</ac:rich-text-body></ac:structured-macro>`;
}

/**
 * 마크다운 → Confluence storage format 변환.
 * 블록쿼트/💡 인사이트를 Confluence 패널 매크로로 변환하여 시각적으로 정리.
 */
export function convertMarkdownToConfluence(mdText: string): string {
  let html = marked.parse(mdText, { async: false, gfm: true }) as string;

  // 코드 블록
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

  // ── Confluence 시각화 ──────────────────────────────────────────────

  // 1. 테이블: Confluence 기본 테두리 스타일
  html = html.replace(/<table>/g, '<table class="wrapped">');

  // 2. 블록쿼트 → 패널 (⚠️ → warning, 나머지 → info)
  html = html.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (_, inner) => {
    const trimmed = inner.trim();
    if (trimmed.includes("⚠️")) return macro("warning", trimmed);
    return macro("info", trimmed);
  });

  // 3. 💡 인사이트 단락 → tip 패널
  html = html.replace(/<p>(💡[\s\S]*?)<\/p>/g, (_, inner) =>
    macro("tip", `<p>${inner}</p>`)
  );

  // 4. Part A / Part B h2 앞에 컬러 구분 패널 타이틀 삽입
  html = html.replace(
    /(<h2>)(Part [AB]\..+?)(<\/h2>)/g,
    (_, open, title, close) => {
      const color = title.startsWith("Part A") ? "#0052CC" : "#00875A";
      const divider = `<ac:structured-macro ac:name="panel"><ac:parameter ac:name="titleBGColor">${color}</ac:parameter><ac:parameter ac:name="titleColor">#FFFFFF</ac:parameter><ac:parameter ac:name="title">${title}</ac:parameter><ac:rich-text-body></ac:rich-text-body></ac:structured-macro>`;
      return divider + open + title + close;
    }
  );

  // 5. 문서 맨 앞에 목차(ToC) 삽입
  const toc = '<ac:structured-macro ac:name="toc"><ac:parameter ac:name="minLevel">2</ac:parameter><ac:parameter ac:name="maxLevel">3</ac:parameter></ac:structured-macro>\n';
  html = toc + html;

  // ── 문자 정리 ───────────────────────────────────────────────────────

  // 이모지 variation selector 제거
  html = html.replace(/[️︎‍]/g, "");

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
