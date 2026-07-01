/**
 * POST /api/analyze — 엑셀 업로드 → 리포트 생성
 */

import { NextResponse } from "next/server";
import { extractStructuredData } from "@/lib/analysis/excel-service";
import { generateReport, generateReportFallback } from "@/lib/analysis/gemini-service";

export const maxDuration = 120;

function extractTitle(md: string): string {
  const match = md.match(/^#\s+(.+)$/m);
  if (match) return match[1].replace(/[^\w\s&·→←↑↓%₩,.()\-+가-힣]/g, "").trim();
  return "월간 채용 분석 리포트";
}

function extractExecutiveSummary(md: string): { indicators: Indicator[]; oneLiner: string } {
  const indicators: Indicator[] = [];

  const pat1 = /\|\s*(🟢|🔴|🟡)\s*\*\*(\w+)\*\*\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/g;
  let m;
  while ((m = pat1.exec(md))) {
    indicators.push({ emoji: m[1], metric: m[3].trim(), result: m[4].trim(), evaluation: m[5].trim() });
  }

  if (indicators.length === 0) {
    const section = /## 1\.\s*Executive Summary\s*\n(.*?)(?=\n---|\n## )/s.exec(md);
    if (section) {
      const pat2 = /\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([+-][\d.]+%)\s*\|\s*(📈|📉|➡️)\s*\|/g;
      const emojiMap: Record<string, string> = { "📈": "🟢", "📉": "🔴", "➡️": "🟡" };
      while ((m = pat2.exec(section[1]))) {
        indicators.push({ emoji: emojiMap[m[5]] || "🟡", metric: m[1].trim(), result: m[2].trim(), evaluation: `${m[4]} ${m[5]}` });
      }
    }
  }

  let oneLiner = "";
  for (const pat of [/한.?줄.?요약.*?\n>\s*\*\*[""\u201c](.+?)[""\u201d]\*\*/m, /한.?줄.?요약[:\s]*\*?\*?(.+?)(?:\*\*)?$/m]) {
    const match = pat.exec(md);
    if (match) { oneLiner = match[1].trim().replace(/^\*+|\*+$/g, "").trim(); break; }
  }

  return { indicators, oneLiner };
}

function normalizeEmoji(text: string): string {
  // variation selector(U+FE0F, U+FE0E)와 zero-width joiner(U+200D) 제거
  return text.replace(/[\ufe0f\ufe0e\u200d]/g, "");
}

function classifyEmoji(raw: string): string {
  const clean = normalizeEmoji(raw);
  if (clean.includes("🔴") || clean.includes("\u{1F534}")) return "🔴";
  if (clean.includes("🟢") || clean.includes("\u{1F7E2}")) return "🟢";
  if (clean.includes("🟡") || clean.includes("\u{1F7E1}")) return "🟡";
  return "🟡";
}

function extractInsights(md: string): Insight[] {
  const insights: Insight[] = [];
  const normalized = normalizeEmoji(md);
  const sectionMatch = /Top\s*5\s*핵심\s*인사이트[^\n]*\n(.*?)(?=\n###\s|\n## |$)/s.exec(normalized);
  if (!sectionMatch) return insights;

  const section = sectionMatch[1];
  // 이모지를 넓게 매칭 (.{1,4}로 이모지 영역 캡처)
  const itemPattern = /[-*]\s*\*\*(🔴|🟢|🟡)\s*(.+?)\*\*[:\s：]\s*(.+?)$/gm;
  const items = [...section.matchAll(itemPattern)];

  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    const start = m.index! + m[0].length;
    const end = i + 1 < items.length ? items[i + 1].index! : section.length;
    const sub = section.slice(start, end);

    const cause = /원인[:\s：]\s*(.+?)$/m.exec(sub)?.[1]?.trim() || "";
    const action = /액션[:\s：]\s*(.+?)$/m.exec(sub)?.[1]?.trim() || "";

    insights.push({ emoji: classifyEmoji(m[1]), title: m[2].trim(), description: m[3].trim(), cause, action });
  }

  return insights.slice(0, 5);
}

function buildIndicatorsFromData(summaryRaw: Record<string, number>): Indicator[] {
  const grade = (mom: number) => {
    if (isNaN(mom)) return { emoji: "🟡" };
    if (mom > 5) return { emoji: "🟢" };
    if (mom < -5) return { emoji: "🔴" };
    return { emoji: "🟡" };
  };
  const gradeInverted = (mom: number) => {
    if (isNaN(mom)) return { emoji: "🟡" };
    if (mom < -5) return { emoji: "🟢" };
    if (mom > 5) return { emoji: "🔴" };
    return { emoji: "🟡" };
  };

  const metrics: [string, number, number, string, boolean][] = [
    ["총 매출", summaryRaw.total_sales, summaryRaw.total_sales_mom, "원", false],
    ["합격 수", summaryRaw.hire_cnt, summaryRaw.hire_mom, "건", false],
    ["서류통과 수", summaryRaw.pass_cnt, summaryRaw.pass_mom, "건", false],
    ["매치업 수", summaryRaw.matchup_cnt, summaryRaw.matchup_mom, "건", false],
    ["신규기업 가입", summaryRaw.new_com_accept, summaryRaw.new_com_mom, "건", false],
  ];
  if (!isNaN(summaryRaw.lead_time)) {
    metrics.push(["채용 리드타임", summaryRaw.lead_time, summaryRaw.lead_time_mom, "일", true]);
  }

  return metrics.map(([name, val, mom, unit, inverted]) => {
    let resultStr: string;
    if (unit === "원") resultStr = `₩${(val / 1e8).toFixed(1)}억`;
    else if (unit === "일") resultStr = `${val.toFixed(1)}일`;
    else resultStr = `${val.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}건`;

    const momVal = isNaN(mom) ? 0 : mom;
    const { emoji } = inverted ? gradeInverted(momVal) : grade(momVal);
    const momStr = !isNaN(mom) ? `${mom >= 0 ? "+" : ""}${mom.toFixed(1)}%` : "N/A";
    let status = momVal > 0 ? "📈" : momVal < 0 ? "📉" : "➡️";
    if (inverted) status = momVal > 0 ? "📉" : momVal < 0 ? "📈" : "➡️";

    return { emoji, metric: name, result: resultStr, evaluation: `${momStr} ${status}` };
  });
}

interface Indicator { emoji: string; metric: string; result: string; evaluation: string }
interface Insight { emoji: string; title: string; description: string; cause: string; action: string }

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file || !file.name.match(/\.xlsx?$/)) {
      return NextResponse.json({ detail: "엑셀 파일(.xlsx)만 업로드 가능합니다." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const targetMonth = (formData.get("target_month") as string) || "";
    const nextMonthBusinessDays = Number(formData.get("next_month_business_days")) || 0;

    let structuredData;
    try {
      structuredData = extractStructuredData(buffer, targetMonth || null, nextMonthBusinessDays);
      const sr = structuredData.summary_raw as unknown as Record<string, number>;
      console.log("[analyze] 매출 원본값:", {
        total_sales: (sr.total_sales / 1e8).toFixed(2) + "억",
        recruit_fee: (sr.recruit_fee / 1e8).toFixed(2) + "억",
        flat_rate_fee: (sr.flat_rate_fee / 1e8).toFixed(2) + "억",
        ad_sales: (sr.ad_sales / 1e8).toFixed(2) + "억",
        refund: sr.refund_recruit_fee != null ? (sr.refund_recruit_fee / 1e8).toFixed(2) + "억" : "없음",
        hire_cnt: sr.hire_cnt,
      });
    } catch (e) {
      return NextResponse.json({ detail: `엑셀 파싱 오류: ${e instanceof Error ? e.message : e}` }, { status: 422 });
    }

    let markdown: string;
    try {
      console.log("[analyze] GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "설정됨" : "미설정");
      markdown = await generateReport(structuredData);
      console.log("[analyze] Gemini 리포트 생성 성공, 길이:", markdown.length);
    } catch (e) {
      console.error("[analyze] Gemini API 실패, fallback 사용:", e instanceof Error ? e.message : e);
      markdown = generateReportFallback(structuredData);
    }

    const title = extractTitle(markdown);
    const indicators = buildIndicatorsFromData(structuredData.summary_raw as unknown as Record<string, number>);
    const { oneLiner } = extractExecutiveSummary(markdown);
    const insights = extractInsights(markdown);

    return NextResponse.json({
      report: { title, markdown, target_month: structuredData.target_month },
      summary: { indicators, one_liner: oneLiner, insights },
    });
  } catch (e) {
    return NextResponse.json({ detail: `서버 오류: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }
}
