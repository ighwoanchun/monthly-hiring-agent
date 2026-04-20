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

/**
 * 합격자 개인별 단계 날짜 (합격기준_단계별_날짜_Raw 시트)
 * apply_date, doc_pass_date, hire_date 는 정확한 일(day) 단위 날짜
 */
export interface HireDetailRow {
  hire_month: Date;
  application_id: string;
  apply_date: Date;
  doc_pass_date: Date;
  hire_date: Date;
  job_category: string;
  company_size: string;
  hire_count: number;
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
  median_lead_time: number;
  ratio: number;
}

export interface SizeAnalysisRow {
  company_size: string;
  hire_count: number;
  avg_lead_time: number;
  median_lead_time: number;
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

// 하드코딩 참조값 (실데이터 계산 불가 시 fallback)
export const DEFAULT_CONVERSION_RATES = {
  apply_to_hire: { current: 0.113, prev_1: 0.452, prev_2: 0.258, prev_3: 0.177 },
  pass_to_hire: { current: 0.260, prev_1: 0.375, prev_2: 0.140, prev_3: 0.075 },
};

export interface ConversionDistribution {
  current: number;
  prev_1: number;
  prev_2: number;
  prev_3: number;
}

/**
 * 합격자 개인별 실측 apply_date를 사용해 월별 지원 시점 분포를 계산합니다.
 * hireDetail이 없으면 hireRaw의 total_lead_time을 역산하는 폴백을 사용합니다.
 */
export function calculateApplyToHireDistribution(
  hireRaw: HireRawRow[],
  targetMonth: Date,
  hireDetail?: HireDetailRow[],
): ConversionDistribution {
  if (hireDetail && hireDetail.length > 0) {
    const hires = hireDetail.filter((r) => sameMonth(r.hire_month, targetMonth));
    const totalHires = hires.reduce((s, r) => s + r.hire_count, 0);
    if (totalHires > 0) {
      const buckets: Record<number, number> = {};
      for (const r of hires) {
        const monthsBack =
          (targetMonth.getFullYear() - r.apply_date.getFullYear()) * 12 +
          (targetMonth.getMonth() - r.apply_date.getMonth());
        const bucket = Math.max(0, monthsBack);
        buckets[bucket] = (buckets[bucket] || 0) + r.hire_count;
      }
      return distributionFromBuckets(buckets, totalHires);
    }
  }

  // Fallback: hire_raw의 total_lead_time 역산
  const hires = hireRaw.filter((r) => sameMonth(r.hire_month, targetMonth));
  const totalHires = hires.reduce((s, r) => s + r.hire_count, 0);
  if (totalHires === 0) return DEFAULT_CONVERSION_RATES.apply_to_hire;

  const refDate = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 15);
  const buckets: Record<number, number> = {};

  for (const r of hires) {
    if (!r.total_lead_time || isNaN(r.total_lead_time)) continue;
    const applyDate = new Date(refDate.getTime() - r.total_lead_time * 86400000);
    const monthsBack =
      (targetMonth.getFullYear() - applyDate.getFullYear()) * 12 +
      (targetMonth.getMonth() - applyDate.getMonth());
    const bucket = Math.max(0, monthsBack);
    buckets[bucket] = (buckets[bucket] || 0) + r.hire_count;
  }

  return distributionFromBuckets(buckets, totalHires);
}

/**
 * 합격자 개인별 실측 doc_pass_date를 사용해 월별 서류통과 시점 분포를 계산합니다.
 * hireDetail이 없으면 hireRaw의 lead_time_doc_pass_to_hire를 역산하는 폴백을 사용합니다.
 */
export function calculatePassToHireDistribution(
  hireRaw: HireRawRow[],
  targetMonth: Date,
  hireDetail?: HireDetailRow[],
): ConversionDistribution {
  if (hireDetail && hireDetail.length > 0) {
    const hires = hireDetail.filter((r) => sameMonth(r.hire_month, targetMonth));
    const totalHires = hires.reduce((s, r) => s + r.hire_count, 0);
    if (totalHires > 0) {
      const buckets: Record<number, number> = {};
      for (const r of hires) {
        const monthsBack =
          (targetMonth.getFullYear() - r.doc_pass_date.getFullYear()) * 12 +
          (targetMonth.getMonth() - r.doc_pass_date.getMonth());
        const bucket = Math.max(0, monthsBack);
        buckets[bucket] = (buckets[bucket] || 0) + r.hire_count;
      }
      return distributionFromBuckets(buckets, totalHires);
    }
  }

  // Fallback
  const hires = hireRaw.filter((r) => sameMonth(r.hire_month, targetMonth));
  const totalHires = hires.reduce((s, r) => s + r.hire_count, 0);
  if (totalHires === 0) return DEFAULT_CONVERSION_RATES.pass_to_hire;

  const refDate = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 15);
  const buckets: Record<number, number> = {};

  for (const r of hires) {
    if (!r.lead_time_doc_pass_to_hire || isNaN(r.lead_time_doc_pass_to_hire)) continue;
    const passDate = new Date(refDate.getTime() - r.lead_time_doc_pass_to_hire * 86400000);
    const monthsBack =
      (targetMonth.getFullYear() - passDate.getFullYear()) * 12 +
      (targetMonth.getMonth() - passDate.getMonth());
    const bucket = Math.max(0, monthsBack);
    buckets[bucket] = (buckets[bucket] || 0) + r.hire_count;
  }

  return distributionFromBuckets(buckets, totalHires);
}

function distributionFromBuckets(
  buckets: Record<number, number>,
  totalHires: number,
): ConversionDistribution {
  return {
    current: (buckets[0] || 0) / totalHires,
    prev_1: (buckets[1] || 0) / totalHires,
    prev_2: (buckets[2] || 0) / totalHires,
    prev_3: Object.entries(buckets)
      .filter(([k]) => Number(k) >= 3)
      .reduce((s, [, v]) => s + v, 0) / totalHires,
  };
}

/**
 * 합격자의 단계별 소요일 통계 (평균·중앙값·90분위)
 */
export interface StageDurationStats {
  stage: string;
  count: number;
  mean: number;
  median: number;
  p90: number;
  min: number;
  max: number;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86400000;
}

const OUTLIER_THRESHOLD_DAYS = 180;

export function calculateStageDurations(
  hireDetail: HireDetailRow[],
  targetMonth: Date,
  options?: { excludeOutliers?: boolean; outlierDays?: number },
): StageDurationStats[] {
  const rows = hireDetail.filter((r) => sameMonth(r.hire_month, targetMonth));
  if (rows.length === 0) return [];

  const threshold = options?.outlierDays ?? OUTLIER_THRESHOLD_DAYS;
  const exclude = options?.excludeOutliers ?? false;

  const applyToDoc: number[] = [];
  const docToHire: number[] = [];
  const total: number[] = [];

  for (const r of rows) {
    const a = daysBetween(r.apply_date, r.doc_pass_date);
    const b = daysBetween(r.doc_pass_date, r.hire_date);
    const t = daysBetween(r.apply_date, r.hire_date);
    const skip = exclude && t > threshold;
    if (!skip) {
      if (a >= 0 && isFinite(a)) applyToDoc.push(a);
      if (b >= 0 && isFinite(b)) docToHire.push(b);
      if (t >= 0 && isFinite(t)) total.push(t);
    }
  }

  const summarize = (stage: string, arr: number[]): StageDurationStats => {
    const sorted = [...arr].sort((x, y) => x - y);
    const sum = arr.reduce((s, v) => s + v, 0);
    return {
      stage,
      count: arr.length,
      mean: arr.length ? sum / arr.length : NaN,
      median: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
      min: sorted[0] ?? NaN,
      max: sorted[sorted.length - 1] ?? NaN,
    };
  };

  return [
    summarize("지원→서류통과", applyToDoc),
    summarize("서류통과→최종합격", docToHire),
    summarize("전체 (지원→합격)", total),
  ];
}

/**
 * 직군별 전체 리드타임(지원→합격) 평균/중앙값/90분위/샘플수.
 * p90 내림차순 정렬 (병목 직군 상위 노출).
 */
export interface JobDurationStats {
  job_category: string;
  count: number;
  mean: number;
  median: number;
  p90: number;
}

export function calculateJobDurationStats(
  hireDetail: HireDetailRow[],
  targetMonth: Date,
): JobDurationStats[] {
  const rows = hireDetail.filter((r) => sameMonth(r.hire_month, targetMonth));
  if (rows.length === 0) return [];

  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const cat = r.job_category || "미분류";
    const d = daysBetween(r.apply_date, r.hire_date);
    if (d >= 0 && isFinite(d)) {
      const arr = groups.get(cat) || [];
      arr.push(d);
      groups.set(cat, arr);
    }
  }

  const result: JobDurationStats[] = [];
  for (const [cat, arr] of groups) {
    if (arr.length === 0) continue;
    const sorted = [...arr].sort((x, y) => x - y);
    result.push({
      job_category: cat,
      count: arr.length,
      mean: arr.reduce((s, v) => s + v, 0) / arr.length,
      median: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
    });
  }

  // p90 내림차순 (가장 느린 직군 상위)
  result.sort((a, b) => b.p90 - a.p90);
  return result;
}

/**
 * 최근 N개월 리드타임 시계열 (평균/중앙값/90분위).
 * 월별 트렌드(개선/악화) 가시화.
 */
export interface DurationTrendRow {
  month: Date;
  count: number;
  mean: number;
  median: number;
  p90: number;
}

export function calculateDurationTrend(
  hireDetail: HireDetailRow[],
  targetMonth: Date,
  nMonths = 4,
): DurationTrendRow[] {
  const result: DurationTrendRow[] = [];
  for (let i = nMonths - 1; i >= 0; i--) {
    const m = addMonths(targetMonth, -i);
    const rows = hireDetail.filter((r) => sameMonth(r.hire_month, m));
    const durations = rows
      .map((r) => daysBetween(r.apply_date, r.hire_date))
      .filter((v) => v >= 0 && isFinite(v))
      .sort((a, b) => a - b);
    if (durations.length === 0) {
      result.push({ month: m, count: 0, mean: NaN, median: NaN, p90: NaN });
      continue;
    }
    result.push({
      month: m,
      count: durations.length,
      mean: durations.reduce((s, v) => s + v, 0) / durations.length,
      median: percentile(durations, 0.5),
      p90: percentile(durations, 0.9),
    });
  }
  return result;
}

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

function meanFromDetail(rows: HireDetailRow[]): number {
  const ds = rows
    .map((r) => daysBetween(r.apply_date, r.hire_date))
    .filter((v) => v >= 0 && isFinite(v));
  return ds.length ? ds.reduce((s, v) => s + v, 0) / ds.length : NaN;
}

export function generateSummary(
  monthly: MonthlyRow[],
  targetMonth: Date,
  hireRaw?: HireRawRow[],
  hireDetail?: HireDetailRow[],
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

  // 실측 우선
  if (hireDetail && hireDetail.length > 0) {
    const pm = prevMonth(targetMonth);
    const curLt = meanFromDetail(hireDetail.filter((r) => sameMonth(r.hire_month, targetMonth)));
    const prevLt = meanFromDetail(hireDetail.filter((r) => sameMonth(r.hire_month, pm)));
    if (!isNaN(curLt)) {
      result.lead_time = curLt;
      result.lead_time_mom = !isNaN(prevLt) ? calcMom(curLt, prevLt) : NaN;
      return result;
    }
  }

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

export function analyzeByJob(
  hireRaw: HireRawRow[],
  targetMonth: Date,
  hireDetail?: HireDetailRow[],
): JobAnalysisRow[] {
  // count/ratio 는 항상 hireRaw (완전 집계, monthly.hire_cnt 와 일치)
  const data = hireRaw
    .filter((r) => sameMonth(r.hire_month, targetMonth))
    .map((r) => ({ ...r, job_category: r.job_category || "미분류" }));

  const groups = groupBy(data, (r) => r.job_category);
  const rows: JobAnalysisRow[] = [];

  // 리드타임: hireDetail 있으면 실측 그룹화, 없으면 집계 가중평균 폴백
  const detailByCat = new Map<string, number[]>();
  if (hireDetail && hireDetail.length > 0) {
    const filtered = hireDetail.filter((r) => sameMonth(r.hire_month, targetMonth));
    for (const r of filtered) {
      const cat = r.job_category || "미분류";
      const d = daysBetween(r.apply_date, r.hire_date);
      if (d >= 0 && isFinite(d)) {
        const arr = detailByCat.get(cat) || [];
        arr.push(d);
        detailByCat.set(cat, arr);
      }
    }
  }

  for (const [category, items] of groups) {
    const hireCount = items.reduce((s, r) => s + r.hire_count, 0);
    const durations = detailByCat.get(category);
    let avgLt: number;
    let medianLt: number;
    if (durations && durations.length > 0) {
      const sorted = [...durations].sort((a, b) => a - b);
      avgLt = sorted.reduce((s, v) => s + v, 0) / sorted.length;
      medianLt = percentile(sorted, 0.5);
    } else {
      avgLt = weightedAvg(items, "total_lead_time", "hire_count");
      medianLt = NaN;
    }
    rows.push({
      job_category: category,
      hire_count: hireCount,
      avg_lead_time: avgLt,
      median_lead_time: medianLt,
      ratio: 0,
    });
  }

  rows.sort((a, b) => b.hire_count - a.hire_count);
  const total = rows.reduce((s, r) => s + r.hire_count, 0);
  for (const r of rows) r.ratio = total > 0 ? (r.hire_count / total) * 100 : 0;

  return rows;
}

export function analyzeBySize(
  hireRaw: HireRawRow[],
  targetMonth: Date,
  hireDetail?: HireDetailRow[],
): SizeAnalysisRow[] {
  const SIZE_ORDER = [
    "1~4", "5~10", "11~50", "51~200", "201~500",
    "501~1000", "1001~5000", "5001~10000", "10001~",
  ];

  // count/ratio는 hireRaw (완전 집계)
  const data = hireRaw
    .filter((r) => sameMonth(r.hire_month, targetMonth))
    .map((r) => ({ ...r, company_size: r.company_size || "미분류" }));

  const groups = groupBy(data, (r) => r.company_size);
  const rows: SizeAnalysisRow[] = [];

  // 리드타임: hireDetail 그룹화
  const detailBySize = new Map<string, number[]>();
  if (hireDetail && hireDetail.length > 0) {
    const filtered = hireDetail.filter((r) => sameMonth(r.hire_month, targetMonth));
    for (const r of filtered) {
      const sz = r.company_size || "미분류";
      const d = daysBetween(r.apply_date, r.hire_date);
      if (d >= 0 && isFinite(d)) {
        const arr = detailBySize.get(sz) || [];
        arr.push(d);
        detailBySize.set(sz, arr);
      }
    }
  }

  for (const [size, items] of groups) {
    const hireCount = items.reduce((s, r) => s + r.hire_count, 0);
    const durations = detailBySize.get(size);
    let avgLt: number;
    let medianLt: number;
    if (durations && durations.length > 0) {
      const sorted = [...durations].sort((a, b) => a - b);
      avgLt = sorted.reduce((s, v) => s + v, 0) / sorted.length;
      medianLt = percentile(sorted, 0.5);
    } else {
      avgLt = weightedAvg(items, "total_lead_time", "hire_count");
      medianLt = NaN;
    }
    rows.push({
      company_size: size,
      hire_count: hireCount,
      avg_lead_time: avgLt,
      median_lead_time: medianLt,
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
