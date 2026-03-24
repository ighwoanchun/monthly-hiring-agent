/**
 * 분석 헬퍼 함수 — Python analyze_helpers.py 포팅
 */

export interface MonthlyRow {
  report_month: Date;
  total_sales: number;
  hire_cnt: number;
  pass_cnt: number;
  matchup_cnt: number;
  new_com_accept: number;
  recruit_fee: number;
  flat_rate_fee: number;
  ad_sales: number;
  refund_recruit_fee?: number;
}

export interface HireRawRow {
  hire_month: Date;
  job_category: string;
  company_size: string;
  hire_count: number;
  total_lead_time: number;
  lead_time_to_doc_pass: number;
  lead_time_doc_pass_to_hire: number;
}

export interface ApplyRawRow {
  apply_month: Date;
  job_category: string;
  company_size: string;
  applicant_count: number;
  doc_pass_count: number;
  hire_count: number;
}

export interface SummaryResult {
  total_sales: number;
  total_sales_mom: number;
  hire_cnt: number;
  hire_mom: number;
  pass_cnt: number;
  pass_mom: number;
  matchup_cnt: number;
  matchup_mom: number;
  new_com_accept: number;
  new_com_mom: number;
  lead_time: number;
  lead_time_mom: number;
}

export interface JobAnalysisRow {
  job_category: string;
  hire_count: number;
  avg_lead_time: number;
  ratio: number;
}

export interface SizeAnalysisRow {
  company_size: string;
  hire_count: number;
  avg_lead_time: number;
  ratio: number;
}

export interface PipelineRow {
  job_category: string;
  applicant_count: number;
  doc_pass_count: number;
  hire_count: number;
  pipeline: number;
  pass_rate: number;
}

export const CONVERSION_RATES = {
  apply_to_hire: { current: 0.113, prev_1: 0.452, prev_2: 0.258, prev_3: 0.177 },
  pass_to_hire: { current: 0.260, prev_1: 0.375, prev_2: 0.140, prev_3: 0.075 },
};

export function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function prevMonth(date: Date): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() - 1);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function calcMom(current: number, previous: number): number {
  if (!previous || previous === 0) return NaN;
  return ((current - previous) / previous) * 100;
}

export function getStatusEmoji(mom: number): string {
  if (isNaN(mom)) return "➡️";
  if (mom > 5) return "📈";
  if (mom < -5) return "📉";
  return "➡️";
}

export function weightedAvg<T>(
  rows: T[],
  valueCol: string,
  weightCol: string,
): number {
  let sumProduct = 0;
  let sumWeight = 0;
  for (const row of rows) {
    const val = (row as Record<string, number>)[valueCol];
    const weight = (row as Record<string, number>)[weightCol];
    if (val != null && !isNaN(val) && weight != null && !isNaN(weight)) {
      sumProduct += val * weight;
      sumWeight += weight;
    }
  }
  return sumWeight === 0 ? NaN : sumProduct / sumWeight;
}

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const key = keyFn(item);
    const group = map.get(key) || [];
    group.push(item);
    map.set(key, group);
  }
  return map;
}

export function generateSummary(
  monthly: MonthlyRow[],
  targetMonth: Date,
  hireRaw?: HireRawRow[],
): SummaryResult {
  let currentIdx = monthly.findIndex((r) => sameMonth(r.report_month, targetMonth));
  if (currentIdx === -1) currentIdx = monthly.length - 1;

  const current = monthly[currentIdx];
  const previous = currentIdx > 0 ? monthly[currentIdx - 1] : current;

  const result: SummaryResult = {
    total_sales: current.total_sales,
    total_sales_mom: calcMom(current.total_sales, previous.total_sales),
    hire_cnt: current.hire_cnt,
    hire_mom: calcMom(current.hire_cnt, previous.hire_cnt),
    pass_cnt: current.pass_cnt,
    pass_mom: calcMom(current.pass_cnt, previous.pass_cnt),
    matchup_cnt: current.matchup_cnt,
    matchup_mom: calcMom(current.matchup_cnt, previous.matchup_cnt),
    new_com_accept: current.new_com_accept,
    new_com_mom: calcMom(current.new_com_accept, previous.new_com_accept),
    lead_time: NaN,
    lead_time_mom: NaN,
  };

  if (hireRaw) {
    const data = hireRaw.filter((r) => sameMonth(r.hire_month, targetMonth));
    const pm = prevMonth(targetMonth);
    const prevData = hireRaw.filter((r) => sameMonth(r.hire_month, pm));

    const curLt = weightedAvg(data, "total_lead_time", "hire_count");
    const prevLt = prevData.length > 0 ? weightedAvg(prevData, "total_lead_time", "hire_count") : NaN;

    result.lead_time = curLt;
    result.lead_time_mom = !isNaN(curLt) && !isNaN(prevLt) ? calcMom(curLt, prevLt) : NaN;
  }

  return result;
}

export function analyzeByJob(hireRaw: HireRawRow[], targetMonth: Date): JobAnalysisRow[] {
  const data = hireRaw
    .filter((r) => sameMonth(r.hire_month, targetMonth))
    .map((r) => ({ ...r, job_category: r.job_category || "미분류" }));

  const groups = groupBy(data, (r) => r.job_category);
  const rows: JobAnalysisRow[] = [];

  for (const [category, items] of groups) {
    const hireCount = items.reduce((s, r) => s + r.hire_count, 0);
    rows.push({
      job_category: category,
      hire_count: hireCount,
      avg_lead_time: weightedAvg(items, "total_lead_time", "hire_count"),
      ratio: 0,
    });
  }

  rows.sort((a, b) => b.hire_count - a.hire_count);
  const total = rows.reduce((s, r) => s + r.hire_count, 0);
  for (const r of rows) r.ratio = total > 0 ? (r.hire_count / total) * 100 : 0;

  return rows;
}

export function analyzeBySize(hireRaw: HireRawRow[], targetMonth: Date): SizeAnalysisRow[] {
  const SIZE_ORDER = [
    "1~4", "5~10", "11~50", "51~200", "201~500",
    "501~1000", "1001~5000", "5001~10000", "10001~",
  ];

  const data = hireRaw
    .filter((r) => sameMonth(r.hire_month, targetMonth))
    .map((r) => ({ ...r, company_size: r.company_size || "미분류" }));

  const groups = groupBy(data, (r) => r.company_size);
  const rows: SizeAnalysisRow[] = [];

  for (const [size, items] of groups) {
    rows.push({
      company_size: size,
      hire_count: items.reduce((s, r) => s + r.hire_count, 0),
      avg_lead_time: weightedAvg(items, "total_lead_time", "hire_count"),
      ratio: 0,
    });
  }

  rows.sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a.company_size);
    const bi = SIZE_ORDER.indexOf(b.company_size);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const total = rows.reduce((s, r) => s + r.hire_count, 0);
  for (const r of rows) r.ratio = total > 0 ? (r.hire_count / total) * 100 : 0;

  return rows;
}

export function analyzePipeline(applyRaw: ApplyRawRow[], targetMonth: Date): PipelineRow[] {
  const data = applyRaw.filter((r) => sameMonth(r.apply_month, targetMonth));
  const groups = groupBy(data, (r) => r.job_category);
  const rows: PipelineRow[] = [];

  for (const [category, items] of groups) {
    const applicant = items.reduce((s, r) => s + r.applicant_count, 0);
    const docPass = items.reduce((s, r) => s + r.doc_pass_count, 0);
    const hire = items.reduce((s, r) => s + r.hire_count, 0);
    rows.push({
      job_category: category,
      applicant_count: applicant,
      doc_pass_count: docPass,
      hire_count: hire,
      pipeline: docPass - hire,
      pass_rate: applicant > 0 ? (docPass / applicant) * 100 : 0,
    });
  }

  rows.sort((a, b) => b.applicant_count - a.applicant_count);
  return rows;
}
