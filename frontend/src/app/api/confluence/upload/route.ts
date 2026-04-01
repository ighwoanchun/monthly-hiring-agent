/**
 * POST /api/confluence/upload — 마크다운 → Confluence 업로드
 */

import { NextResponse } from "next/server";
import { convertMarkdownToConfluence, uploadToConfluence } from "@/lib/services/confluence";

export async function POST(request: Request) {
  try {
    const { markdown, title } = await request.json();
    if (!markdown || !title) {
      return NextResponse.json({ detail: "markdown과 title은 필수입니다." }, { status: 400 });
    }

    const bodyHtml = convertMarkdownToConfluence(markdown);

    // Confluence에 업로드 전에 HTML 검증용 로그
    console.log("[confluence] HTML 길이:", bodyHtml.length);
    console.log("[confluence] 사용된 태그:", [...new Set(bodyHtml.match(/<([a-z][a-z0-9]*)\b/gi) || [])].join(", "));

    const result = await uploadToConfluence(title, bodyHtml);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[confluence] 업로드 실패:", msg);
    return NextResponse.json({ detail: `Confluence 업로드 실패: ${msg}` }, { status: 502 });
  }
}
