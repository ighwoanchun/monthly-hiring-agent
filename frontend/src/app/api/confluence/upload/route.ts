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
    const result = await uploadToConfluence(title, bodyHtml);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { detail: `Confluence 업로드 실패: ${e instanceof Error ? e.message : e}` },
      { status: 502 },
    );
  }
}
