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

function convertInsightsToCards(html: string): string {
  const pattern =
    /(<(?:h[23]|p)>.*?Top\s*5\s*핵심\s*인사이트.*?<\/(?:h[23]|p)>)\s*<ul>(.*?)<\/ul>/s;
  const match = pattern.exec(html);
  if (!match) return html;

  const heading = match[1];
  const listHtml = match[2];
  const liItems = [...listHtml.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => m[1].trim());

  const groups: Array<{ title: string; cause: string; action: string }> = [];
  for (const text of liItems) {
    if (/<strong>[🔴🟢🟡]/.test(text)) {
      groups.push({ title: text, cause: "", action: "" });
    } else if (groups.length > 0) {
      if (text.startsWith("원인:")) groups[groups.length - 1].cause = text.slice(3).trim();
      else if (text.startsWith("액션:")) groups[groups.length - 1].action = text.slice(3).trim();
    }
  }

  const cards = groups.map((g) => {
    let borderColor = "#EAB308";
    if (g.title.includes("🔴")) borderColor = "#EF4444";
    else if (g.title.includes("🟢")) borderColor = "#22C55E";

    let card = `<div style="background-color: #f9fafb; border-left: 4px solid ${borderColor}; border-radius: 4px; padding: 12px 16px; margin: 8px 0;"><div style="font-size: 14px;">${g.title}</div>`;
    const subItems: string[] = [];
    if (g.cause)
      subItems.push(`<li style="color: #4b5563; margin-bottom: 2px;"><strong>원인:</strong> ${g.cause}</li>`);
    if (g.action)
      subItems.push(`<li style="color: #2563eb; margin-bottom: 2px;"><strong>액션:</strong> ${g.action}</li>`);
    if (subItems.length > 0)
      card += `<ul style="margin: 6px 0 0 0; padding-left: 20px; font-size: 13px;">${subItems.join("")}</ul>`;
    card += "</div>";
    return card;
  });

  return html.slice(0, match.index!) + heading + "\n" + cards.join("\n") + html.slice(match.index! + match[0].length);
}

export function convertMarkdownToConfluence(mdText: string): string {
  let html = marked.parse(mdText, { async: false, gfm: true }) as string;

  // 코드 블록 스타일
  html = html.replace(
    /<pre><code(?:\s+class="language-(\w+)")?\s*>(.*?)<\/code><\/pre>/gs,
    (_, _lang, code) =>
      `<pre style="background-color: #f4f5f7; border: 1px solid #dfe1e6; border-radius: 3px; padding: 12px; overflow-x: auto; font-family: SFMono-Medium, Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap;">${code.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')}</pre>`,
  );

  // blockquote 스타일
  html = html.replace(/<blockquote>(.*?)<\/blockquote>/gs, (_, content) => {
    const c = content.trim();
    const [bg, border] = ["주의", "⚠️", "Warning"].some((k) => c.includes(k))
      ? ["#FFFAE6", "#FF8B00"]
      : ["#DEEBFF", "#0052CC"];
    return `<div style="background-color: ${bg}; border-left: 4px solid ${border}; padding: 12px 16px; margin: 8px 0; border-radius: 3px;">${c}</div>`;
  });

  // 테이블 스타일
  html = html.replace(/<table>/g, '<table style="border-collapse: collapse;">');
  html = html.replace(
    /<th>/g,
    '<th style="background-color: #f4f5f7; border: 1px solid #dfe1e6; padding: 8px 12px; font-weight: bold; text-align: left;">',
  );
  html = html.replace(/<td>/g, '<td style="border: 1px solid #dfe1e6; padding: 8px 12px;">');
  html = html.replace(
    /<th style="text-align: (\w+);">/g,
    '<th style="background-color: #f4f5f7; border: 1px solid #dfe1e6; padding: 8px 12px; font-weight: bold; text-align: $1;">',
  );
  html = html.replace(
    /<td style="text-align: (\w+);">/g,
    '<td style="border: 1px solid #dfe1e6; padding: 8px 12px; text-align: $1;">',
  );
  // XHTML 호환: self-closing 태그 변환
  html = html.replace(/<hr\s*>/g, "<hr />");
  html = html.replace(/<br\s*>/g, "<br />");
  html = html.replace(/<img([^>]*?)(?<!\/)>/g, "<img$1 />");

  html = convertInsightsToCards(html);

  // 이모지 정규화
  html = html.replace(/\ufe0f/g, "").replace(/\ufe0e/g, "").replace(/\u200d/g, "");

  // Confluence가 거부하는 제어 문자 제거 (U+0000~U+001F 중 탭/줄바꿈 제외)
  // eslint-disable-next-line no-control-regex
  html = html.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

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
    throw new Error(`Confluence 페이지 생성/수정 실패: ${res.status}. ${body.slice(0, 200)}`);
  }

  const result = await res.json();
  return {
    page_id: result.id,
    page_url: `${baseUrl()}/wiki${result._links?.webui || ""}`,
  };
}
