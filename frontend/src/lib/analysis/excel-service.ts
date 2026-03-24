/**
 * 엑셀 파일에서 구조화된 데이터를 추출하는 서비스 — Python excel_service.py 포팅
 */

import * as XLSX from "xlsx";
import {
  type MonthlyRow,
  type HireRawRow,
  type ApplyRawRow,
  type SummaryResult,
  sameMonth,
  prevMonth,
  calcMom,
  getStatusEmoji,
  weightedAvg,
  generateSummary,
  analyzeByJob,
  analyzeBySize,
  analyzePipeline,
  CONVERSION_RATES,
} from "./helpers";

export interface StructuredData {
  target_month: string;
  summary: string;
  summary_raw: SummaryResult;
  monthly_kpi: string;
  revenue_breakdown: string;
  job_analysis: string;
  size_analysis: string;
  leadtime_analysis: string;
  pipeline_analysis: string;
  apply_size_analysis: string;
  conversion_rates: string;
  pipeline_prediction: string;
  job_pipeline_trend: string;
  next_month_business_days: number;
}

function parseDate(val: unknown): Date {
  if (typeof val === "number") {
    // Excel serial date → XLSX가 정확한 y/m/d를 반환
    const parsed = XLSX.SSF.parse_date_code(val);
    return new Date(parsed.y, parsed.m - 1, 1); // 월 1일로 정규화
  }
  if (val instanceof Date) {
    return new Date(val.getFullYear(), val.getMonth(), 1);
  }
  const d = new Date(String(val));
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function loadSheets(buffer: Buffer): {
  monthly: MonthlyRow[];
  applyRaw: ApplyRawRow[];
  hireRaw: HireRawRow[];
} {
  const wb = XLSX.read(buffer, { type: "buffer" });

  const toJson = (name: string) => {
    const sheet = wb.Sheets[name];
    if (!sheet) throw new Error(`시트 '${name}'를 찾을 수 없습니다.`);
    return XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
  };

  const monthly = toJson("월통합분석").map((r) => ({
    report_month: parseDate(r.report_month),
    total_sales: Number(r.total_sales) || 0,
    hire_cnt: Number(r.hire_cnt) || 0,
    pass_cnt: Number(r.pass_cnt) || 0,
    matchup_cnt: Number(r.matchup_cnt) || 0,
    new_com_accept: Number(r.new_com_accept) || 0,
    recruit_fee: Number(r.recruit_fee) || 0,
    flat_rate_fee: Number(r.flat_rate_fee) || 0,
    ad_sales: Number(r.ad_sales) || 0,
    refund_recruit_fee: r.refund_recruit_fee != null ? Number(r.refund_recruit_fee) : undefined,
  }));

  const applyRaw = toJson("지원기준리드타임_raw").map((r) => ({
    apply_month: parseDate(r.apply_month),
    job_category: String(r.job_category || ""),
    company_size: String(r.company_size || ""),
    applicant_count: Number(r.applicant_count) || 0,
    doc_pass_count: Number(r.doc_pass_count) || 0,
    hire_count: Number(r.hire_count) || 0,
  }));

  const hireRaw = toJson("합격기준리드타임_raw").map((r) => ({
    hire_month: parseDate(r.hire_month),
    job_category: String(r.job_category || ""),
    company_size: String(r.company_size || ""),
    hire_count: Number(r.hire_count) || 0,
    total_lead_time: Number(r.total_lead_time) || 0,
    lead_time_to_doc_pass: Number(r.lead_time_to_doc_pass) || 0,
    lead_time_doc_pass_to_hire: Number(r.lead_time_doc_pass_to_hire) || 0,
  }));

  return { monthly, applyRaw, hireRaw };
}

function formatSummary(s: SummaryResult): string {
  const lines = ["[Executive Summary 핵심 지표]"];
  const metrics: [string, number, number, string][] = [
    ["총 매출", s.total_sales, s.total_sales_mom, "원"],
    ["합격 수", s.hire_cnt, s.hire_mom, "건"],
    ["서류통과 수", s.pass_cnt, s.pass_mom, "건"],
    ["매치업 수", s.matchup_cnt, s.matchup_mom, "건"],
    ["신규기업 가입", s.new_com_accept, s.new_com_mom, "건"],
  ];
  if (!isNaN(s.lead_time)) {
    metrics.push(["채용 리드타임", s.lead_time, s.lead_time_mom, "일"]);
  }

  for (const [name, val, mom, unit] of metrics) {
    const emoji = !isNaN(mom) ? getStatusEmoji(mom) : "➡️";
    let valStr: string;
    if (unit === "원") valStr = `₩${(val / 1e8).toFixed(1)}억`;
    else if (unit === "일") valStr = `${val.toFixed(1)}일`;
    else valStr = `${val.toFixed(0)}${unit}`;
    const momStr = !isNaN(mom) ? `${mom >= 0 ? "+" : ""}${mom.toFixed(1)}%` : "N/A";
    lines.push(`- ${name}: ${valStr} (MoM ${momStr}) ${emoji}`);
  }
  return lines.join("\n");
}

function findMonthIdx(monthly: MonthlyRow[], targetMonth: Date): number {
  const idx = monthly.findIndex((r) => sameMonth(r.report_month, targetMonth));
  return idx === -1 ? monthly.length - 1 : idx;
}

function formatMonthlyKpi(monthly: MonthlyRow[], targetMonth: Date): string {
  const idx = findMonthIdx(monthly, targetMonth);
  const start = Math.max(0, idx - 3);
  const rows = monthly.slice(start, idx + 1);

  const lines = ["[월별 KPI 추이 - 최근 4개월]"];
  const headers = rows.map((r) => {
    const d = r.report_month;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  lines.push(`| 지표 | ${headers.join(" | ")} |`);
  lines.push(`|---${"|---".repeat(rows.length)}|`);

  const cols: [string, string, (v: number) => string][] = [
    ["hire_cnt", "합격 수", (v) => v.toFixed(0)],
    ["pass_cnt", "서류통과 수", (v) => v.toFixed(0)],
    ["matchup_cnt", "매치업 수", (v) => v.toFixed(0)],
    ["total_sales", "총 매출(억)", (v) => (v / 1e8).toFixed(1)],
    ["new_com_accept", "신규기업 가입", (v) => v.toFixed(0)],
  ];

  for (const [col, label, fmt] of cols) {
    const vals = rows.map((r) => fmt(r[col as keyof MonthlyRow] as number));
    lines.push(`| ${label} | ${vals.join(" | ")} |`);
  }
  return lines.join("\n");
}

function formatRevenue(monthly: MonthlyRow[], targetMonth: Date): string {
  const idx = findMonthIdx(monthly, targetMonth);
  const row = monthly[idx];
  const total = row.total_sales;
  const prev = idx > 0 ? monthly[idx - 1] : null;

  const items: [string, string][] = [
    ["recruit_fee", "수수료 매출"],
    ["flat_rate_fee", "정액제 매출"],
    ["ad_sales", "광고 매출"],
  ];

  const parts: string[] = [];
  for (const [col, label] of items) {
    const val = (row[col as keyof MonthlyRow] as number) || 0;
    const pct = total ? (val / total) * 100 : 0;
    let momStr = "";
    if (prev) {
      const prevVal = (prev[col as keyof MonthlyRow] as number) || 0;
      if (prevVal !== 0) {
        momStr = `, MoM ${calcMom(val, prevVal) >= 0 ? "+" : ""}${calcMom(val, prevVal).toFixed(1)}%`;
      }
    }
    parts.push(`- ${label}: ₩${(val / 1e8).toFixed(1)}억 (${pct.toFixed(1)}%${momStr})`);
  }

  if (row.refund_recruit_fee != null) {
    const refund = row.refund_recruit_fee;
    const refundAbs = Math.abs(refund);
    const recruitFee = row.recruit_fee || 0;
    const netRecruit = recruitFee + refund;

    let refundLine = recruitFee
      ? `- 환불 차감: ₩${(refundAbs / 1e8).toFixed(1)}억 (수수료 매출의 ${((refundAbs / recruitFee) * 100).toFixed(1)}%)`
      : `- 환불 차감: ₩${(refundAbs / 1e8).toFixed(1)}억`;

    if (prev?.refund_recruit_fee != null) {
      const prevRefund = Math.abs(prev.refund_recruit_fee);
      if (prevRefund > 0) {
        const refundChange = calcMom(refundAbs, prevRefund);
        const direction = refundChange > 0 ? "증가 → 순매출 악화" : "감소 → 순매출 개선";
        refundLine += ` (전월 ₩${(prevRefund / 1e8).toFixed(1)}억 → 당월 ₩${(refundAbs / 1e8).toFixed(1)}억, ${refundChange >= 0 ? "+" : ""}${refundChange.toFixed(1)}% ${direction})`;
      }
    }
    parts.push(refundLine);
    parts.push(`- 수수료 순매출: ₩${(netRecruit / 1e8).toFixed(1)}억 (수수료 - 환불)`);
  }

  return "[매출 구조]\n" + parts.join("\n");
}

function formatJobAnalysis(
  rows: ReturnType<typeof analyzeByJob>,
  hireRaw?: HireRawRow[],
  targetMonth?: Date,
): string {
  // 전월 데이터 구하기
  let prevByJob: Map<string, number> | undefined;
  if (hireRaw && targetMonth) {
    const pm = prevMonth(targetMonth);
    const prevData = hireRaw.filter((r) => sameMonth(r.hire_month, pm));
    prevByJob = new Map<string, number>();
    for (const r of prevData) {
      const cat = r.job_category || "미분류";
      prevByJob.set(cat, (prevByJob.get(cat) || 0) + r.hire_count);
    }
  }

  const lines = ["[직군별 합격 분석]"];
  lines.push("| 직군 | 합격 수 | 비율 | 전월 | 증감% | 상태 | 평균 리드타임(지원→합격) |");
  lines.push("|---|---|---|---|---|---|---|");

  const top10 = rows.slice(0, 10);
  const others = rows.slice(10);

  for (const r of top10) {
    const lt = !isNaN(r.avg_lead_time) ? `${r.avg_lead_time.toFixed(1)}일` : "-";
    const prev = prevByJob?.get(r.job_category);
    const prevStr = prev != null ? prev.toFixed(0) : "-";
    const mom = prev != null && prev > 0 ? calcMom(r.hire_count, prev) : NaN;
    const momStr = !isNaN(mom) ? `${mom >= 0 ? "+" : ""}${mom.toFixed(1)}%` : "-";
    const emoji = !isNaN(mom) ? getStatusEmoji(mom) : "-";
    lines.push(`| ${r.job_category} | ${r.hire_count.toFixed(0)} | ${r.ratio.toFixed(1)}% | ${prevStr} | ${momStr} | ${emoji} | ${lt} |`);
  }

  if (others.length > 0) {
    const sum = others.reduce((s, r) => s + r.hire_count, 0);
    const ratioSum = others.reduce((s, r) => s + r.ratio, 0);
    lines.push(`| 기타 (${others.length}개 직군) | ${sum.toFixed(0)} | ${ratioSum.toFixed(1)}% | - | - | - | - |`);
  }

  const total = rows.reduce((s, r) => s + r.hire_count, 0);
  lines.push(`| **합계** | **${total.toFixed(0)}** | **100%** | | | | |`);
  return lines.join("\n");
}

function formatSizeAnalysis(rows: ReturnType<typeof analyzeBySize>): string {
  const lines = ["[기업규모별 합격 분석]"];
  lines.push("| 기업규모 | 합격 수 | 비율 | 평균 리드타임(지원→합격) |");
  lines.push("|---|---|---|---|");

  for (const r of rows) {
    const lt = !isNaN(r.avg_lead_time) ? `${r.avg_lead_time.toFixed(1)}일` : "-";
    const name = r.company_size || "미분류";
    lines.push(`| ${name} | ${r.hire_count.toFixed(0)} | ${r.ratio.toFixed(1)}% | ${lt} |`);
  }

  const total = rows.reduce((s, r) => s + r.hire_count, 0);
  lines.push(`| **합계** | **${total.toFixed(0)}** | **100%** | |`);
  return lines.join("\n");
}

function formatLeadtime(hireRaw: HireRawRow[], targetMonth: Date): string {
  const data = hireRaw.filter((r) => sameMonth(r.hire_month, targetMonth));
  if (data.length === 0) return "[리드타임 분석]\n데이터 없음";

  const pm = prevMonth(targetMonth);
  const prevData = hireRaw.filter((r) => sameMonth(r.hire_month, pm));

  const steps: [string, string][] = [
    ["lead_time_to_doc_pass", "지원→서류통과"],
    ["lead_time_doc_pass_to_hire", "서류통과→최종합격"],
    ["total_lead_time", "전체 리드타임"],
  ];

  const prevLabel = prevData.length > 0 ? `${pm.getMonth() + 1}월` : "전월";
  const curLabel = `${targetMonth.getMonth() + 1}월`;

  const lines = ["[리드타임 분석 - 단계별 소요 기간 (전월 비교)]"];
  lines.push(`| 단계 | ${prevLabel} | ${curLabel} | 변화 | 상태 |`);
  lines.push("|---|---|---|---|---|");

  for (const [col, label] of steps) {
    const curVal = weightedAvg(data, col as keyof HireRawRow & string, "hire_count");
    const prevVal = prevData.length > 0 ? weightedAvg(prevData, col as keyof HireRawRow & string, "hire_count") : NaN;

    const curStr = !isNaN(curVal) ? `${curVal.toFixed(1)}일` : "-";
    const prevStr = !isNaN(prevVal) ? `${prevVal.toFixed(1)}일` : "-";

    let diffStr = "-";
    let emoji = "➡️";
    if (!isNaN(curVal) && !isNaN(prevVal)) {
      const diff = curVal - prevVal;
      diffStr = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}일`;
      emoji = getStatusEmoji(calcMom(curVal, prevVal));
    }

    lines.push(`| ${label} | ${prevStr} | ${curStr} | ${diffStr} | ${emoji} |`);
  }

  return lines.join("\n");
}

function formatPipeline(
  rows: ReturnType<typeof analyzePipeline>,
  applyRaw?: ApplyRawRow[],
  targetMonth?: Date,
): string {
  // 전월 지원 데이터
  let prevByJob: Map<string, { applicant: number; docPass: number }> | undefined;
  if (applyRaw && targetMonth) {
    const pm = prevMonth(targetMonth);
    const prevData = applyRaw.filter((r) => sameMonth(r.apply_month, pm));
    prevByJob = new Map();
    for (const r of prevData) {
      const cat = r.job_category;
      const g = prevByJob.get(cat) || { applicant: 0, docPass: 0 };
      g.applicant += r.applicant_count;
      g.docPass += r.doc_pass_count;
      prevByJob.set(cat, g);
    }
  }

  const lines = ["[파이프라인 분석 - 지원기준]"];
  lines.push("| 직군 | 지원 수 | 서류통과 수 | 합격 수 | 파이프라인 | 서류통과율 | 지원 증감% |");
  lines.push("|---|---|---|---|---|---|---|");

  for (const r of rows.slice(0, 10)) {
    const prev = prevByJob?.get(r.job_category);
    const mom = prev && prev.applicant > 0 ? calcMom(r.applicant_count, prev.applicant) : NaN;
    const momStr = !isNaN(mom) ? `${mom >= 0 ? "+" : ""}${mom.toFixed(1)}% ${getStatusEmoji(mom)}` : "-";
    lines.push(
      `| ${r.job_category} | ${r.applicant_count.toLocaleString("ko-KR")} | ${r.doc_pass_count.toLocaleString("ko-KR")} | ${r.hire_count.toFixed(0)} | ${r.pipeline.toFixed(0)} | ${r.pass_rate.toFixed(1)}% | ${momStr} |`,
    );
  }

  const totals = rows.reduce(
    (acc, r) => ({
      applicant: acc.applicant + r.applicant_count,
      docPass: acc.docPass + r.doc_pass_count,
      hire: acc.hire + r.hire_count,
      pipeline: acc.pipeline + r.pipeline,
    }),
    { applicant: 0, docPass: 0, hire: 0, pipeline: 0 },
  );
  const totalPassRate = totals.applicant > 0 ? (totals.docPass / totals.applicant) * 100 : 0;
  lines.push(
    `| **합계** | **${totals.applicant.toLocaleString("ko-KR")}** | **${totals.docPass.toLocaleString("ko-KR")}** | **${totals.hire.toFixed(0)}** | **${totals.pipeline.toFixed(0)}** | **${totalPassRate.toFixed(1)}%** | |`,
  );
  return lines.join("\n");
}

function formatApplyBySize(applyRaw: ApplyRawRow[], targetMonth: Date): string {
  const data = applyRaw.filter((r) => sameMonth(r.apply_month, targetMonth));
  if (data.length === 0) return "[지원기준 기업규모별]\n데이터 없음";

  const groups = new Map<string, { applicant: number; docPass: number; hire: number }>();
  for (const r of data) {
    const key = r.company_size || "미분류";
    const g = groups.get(key) || { applicant: 0, docPass: 0, hire: 0 };
    g.applicant += r.applicant_count;
    g.docPass += r.doc_pass_count;
    g.hire += r.hire_count;
    groups.set(key, g);
  }

  const rows = [...groups.entries()]
    .map(([size, g]) => ({
      company_size: size,
      applicant_count: g.applicant,
      doc_pass_count: g.docPass,
      pipeline: g.docPass - g.hire,
      pass_rate: g.applicant > 0 ? (g.docPass / g.applicant) * 100 : 0,
    }))
    .sort((a, b) => b.applicant_count - a.applicant_count);

  const lines = ["[지원기준 기업규모별 현황]"];
  lines.push("| 기업규모 | 지원자 | 서류통과 | 통과율 | 파이프라인 |");
  lines.push("|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(
      `| ${r.company_size} | ${r.applicant_count.toFixed(0)} | ${r.doc_pass_count.toFixed(0)} | ${r.pass_rate.toFixed(1)}% | ${r.pipeline.toFixed(0)} |`,
    );
  }
  return lines.join("\n");
}

function formatConversionRates(): string {
  const ar = CONVERSION_RATES.apply_to_hire;
  const pr = CONVERSION_RATES.pass_to_hire;
  return [
    "[전환율 참조값]",
    `지원→합격: 당월 ${(ar.current * 100).toFixed(1)}% / 전월 ${(ar.prev_1 * 100).toFixed(1)}% / 전전월 ${(ar.prev_2 * 100).toFixed(1)}% / 전전전월 ${(ar.prev_3 * 100).toFixed(1)}%`,
    `서류통과→합격: 당월 ${(pr.current * 100).toFixed(1)}% / 전월 ${(pr.prev_1 * 100).toFixed(1)}% / 전전월 ${(pr.prev_2 * 100).toFixed(1)}% / 전전전월 ${(pr.prev_3 * 100).toFixed(1)}%`,
  ].join("\n");
}

function calcHireDocPassRate(applyRaw: ApplyRawRow[], monthly: MonthlyRow[]): number {
  const sortedMonths = [...new Set(monthly.map((r) => r.report_month.getTime()))].sort().map((t) => new Date(t));
  const rates: number[] = [];

  for (const m of sortedMonths) {
    const hire = monthly.find((r) => sameMonth(r.report_month, m))?.hire_cnt || 0;
    const pm = prevMonth(m);
    const prevDoc = applyRaw.filter((r) => sameMonth(r.apply_month, pm)).reduce((s, r) => s + r.doc_pass_count, 0);
    if (prevDoc > 0) rates.push(hire / prevDoc);
  }

  return rates.length > 0 ? rates.reduce((s, r) => s + r, 0) / rates.length : 0.1;
}

function formatPipelinePrediction(applyRaw: ApplyRawRow[], monthly: MonthlyRow[], targetMonth: Date): string {
  const nextMonthNum = targetMonth.getMonth() === 11 ? 1 : targetMonth.getMonth() + 2;
  const avgRate = calcHireDocPassRate(applyRaw, monthly);
  const dist = CONVERSION_RATES.pass_to_hire;
  const currentHire = monthly.find((r) => sameMonth(r.report_month, targetMonth))?.hire_cnt || 0;

  const monthsData: [string, number, number, number][] = [];
  const offsets: [number, number][] = [
    [0, dist.prev_1],
    [1, dist.prev_2],
    [2, dist.prev_3],
  ];

  for (const [offset, distPct] of offsets) {
    const m = new Date(targetMonth);
    m.setMonth(m.getMonth() - offset);
    const docPass = applyRaw.filter((r) => sameMonth(r.apply_month, m)).reduce((s, r) => s + r.doc_pass_count, 0);
    const actualRate = docPass > 0 ? (currentHire * distPct) / docPass : 0;
    const expected = docPass * actualRate;
    monthsData.push([`${m.getMonth() + 1}월 서류통과→${nextMonthNum}월`, docPass, actualRate * 100, expected]);
  }

  const totalFromSources = monthsData.reduce((s, [, , , exp]) => s + exp, 0);
  const knownDist = dist.prev_1 + dist.prev_2 + dist.prev_3;
  const otherExpected = knownDist > 0 ? (totalFromSources * (1 - knownDist)) / knownDist : 0;
  const totalExpected = totalFromSources + otherExpected;

  const lines = [`[파이프라인 기반 합격 예측 - ${nextMonthNum}월 (기준 전환율 ${(avgRate * 100).toFixed(1)}%)]`];
  lines.push("| 파이프라인 소스 | 서류통과 수 | 실제 전환율 | 예상 기여 합격 |");
  lines.push("|---|---|---|---|");
  for (const [label, qty, rate, exp] of monthsData) {
    lines.push(`| ${label} | ${qty.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} | ${rate.toFixed(1)}% | ${exp.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} |`);
  }
  lines.push(`| 당월+기타 소스 (추정) | - | - | ${otherExpected.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} |`);
  lines.push(`| **합계** | | | **${totalExpected.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}** |`);

  return lines.join("\n");
}

function formatJobPipelineTrend(applyRaw: ApplyRawRow[], monthly: MonthlyRow[], targetMonth: Date): string {
  const pm = prevMonth(targetMonth);
  const nextMonthNum = targetMonth.getMonth() === 11 ? 1 : targetMonth.getMonth() + 2;
  const rate = calcHireDocPassRate(applyRaw, monthly);

  const curData = applyRaw.filter((r) => sameMonth(r.apply_month, targetMonth));
  const prevData = applyRaw.filter((r) => sameMonth(r.apply_month, pm));

  const curByJob = new Map<string, number>();
  for (const r of curData) curByJob.set(r.job_category, (curByJob.get(r.job_category) || 0) + r.doc_pass_count);

  const prevByJob = new Map<string, number>();
  for (const r of prevData) prevByJob.set(r.job_category, (prevByJob.get(r.job_category) || 0) + r.doc_pass_count);

  const merged = [...curByJob.entries()]
    .map(([cat, docPass]) => ({
      job_category: cat,
      doc_pass_count: docPass,
      expected_hire: docPass * rate,
      mom: prevByJob.has(cat) && prevByJob.get(cat)! > 0 ? calcMom(docPass, prevByJob.get(cat)!) : NaN,
    }))
    .sort((a, b) => b.doc_pass_count - a.doc_pass_count);

  const lines = [`[직군별 ${nextMonthNum}월 파이프라인 (전환율 ${(rate * 100).toFixed(1)}%)]`];
  lines.push(`| 직군 | ${targetMonth.getMonth() + 1}월 서류통과 | 예상 ${nextMonthNum}월 합격 | 전월 대비 | 트렌드 |`);
  lines.push("|---|---|---|---|---|");

  for (const r of merged.slice(0, 10)) {
    const doc = r.doc_pass_count.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
    const exp = r.expected_hire.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
    const momStr = !isNaN(r.mom) ? `${r.mom >= 0 ? "+" : ""}${r.mom.toFixed(1)}%` : "-";
    const emoji = !isNaN(r.mom) ? getStatusEmoji(r.mom) : "➡️";
    lines.push(`| ${r.job_category} | ${doc} | ${exp} | ${momStr} | ${emoji} |`);
  }

  return lines.join("\n");
}

export function extractStructuredData(
  buffer: Buffer,
  targetMonthStr?: string | null,
  nextMonthBusinessDays = 0,
): StructuredData {
  const { monthly, applyRaw, hireRaw } = loadSheets(buffer);

  // 대상월 결정
  const maxMonth = monthly.reduce((max, r) => (r.report_month > max ? r.report_month : max), monthly[0].report_month);
  let tm: Date;
  if (targetMonthStr) {
    const requested = new Date(targetMonthStr);
    // 요청한 월이 데이터에 있는지 확인
    const exists = monthly.some((r) => sameMonth(r.report_month, requested));
    if (exists) {
      tm = requested;
    } else {
      console.warn(`[extractStructuredData] 요청월 ${requested.toISOString()} 데이터 없음 → 최대 가용월 사용`);
      tm = maxMonth;
    }
  } else {
    tm = maxMonth;
  }

  console.log("[extractStructuredData] 대상월:", tm.toISOString(), `(${tm.getFullYear()}년 ${tm.getMonth() + 1}월)`);

  const monthLabel = `${tm.getFullYear()}년 ${tm.getMonth() + 1}월`;

  const summaryRaw = generateSummary(monthly, tm, hireRaw);
  const jobDf = analyzeByJob(hireRaw, tm);
  const sizeDf = analyzeBySize(hireRaw, tm);
  const pipelineDf = analyzePipeline(applyRaw, tm);

  return {
    target_month: monthLabel,
    summary: formatSummary(summaryRaw),
    summary_raw: summaryRaw,
    monthly_kpi: formatMonthlyKpi(monthly, tm),
    revenue_breakdown: formatRevenue(monthly, tm),
    job_analysis: formatJobAnalysis(jobDf, hireRaw, tm),
    size_analysis: formatSizeAnalysis(sizeDf),
    leadtime_analysis: formatLeadtime(hireRaw, tm),
    pipeline_analysis: formatPipeline(pipelineDf, applyRaw, tm),
    apply_size_analysis: formatApplyBySize(applyRaw, tm),
    conversion_rates: formatConversionRates(),
    pipeline_prediction: formatPipelinePrediction(applyRaw, monthly, tm),
    job_pipeline_trend: formatJobPipelineTrend(applyRaw, monthly, tm),
    next_month_business_days: nextMonthBusinessDays,
  };
}
