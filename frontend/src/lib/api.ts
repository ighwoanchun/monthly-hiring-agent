const API_BASE = "";

export interface AnalysisResult {
  report: {
    title: string;
    markdown: string;
    target_month: string;
  };
  summary: {
    indicators: Array<{
      emoji: string;
      metric: string;
      result: string;
      evaluation: string;
    }>;
    one_liner: string;
    insights?: Array<{
      emoji: string;
      title: string;
      description: string;
      cause: string;
      action: string;
    }>;
  };
}

export interface ConfluenceResult {
  page_id: string;
  page_url: string;
}

export interface SlackResult {
  message_ts: string;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function analyzeExcel(
  file: File,
  targetMonth?: string,
  nextMonthBusinessDays?: number
): Promise<AnalysisResult> {
  const formData = new FormData();
  formData.append("file", file);
  if (targetMonth) {
    formData.append("target_month", targetMonth);
  }
  if (nextMonthBusinessDays) {
    formData.append("next_month_business_days", String(nextMonthBusinessDays));
  }

  const submitRes = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    body: formData,
  });

  if (!submitRes.ok) {
    const err = await submitRes.json().catch(() => ({ detail: submitRes.statusText }));
    throw new Error(err.detail || "분석 실패");
  }

  const { jobId } = await submitRes.json();

  // 인그레스 타임아웃(약 30초)보다 오래 걸리는 분석을 폴링으로 우회
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetch(`${API_BASE}/api/analyze/${jobId}`);

    if (pollRes.status === 202) continue;

    if (!pollRes.ok) {
      const err = await pollRes.json().catch(() => ({ detail: pollRes.statusText }));
      throw new Error(err.detail || "분석 실패");
    }

    return pollRes.json();
  }

  throw new Error("분석 시간이 너무 오래 걸립니다. 잠시 후 다시 시도해주세요.");
}

export async function uploadToConfluence(
  markdown: string,
  title: string
): Promise<ConfluenceResult> {
  const res = await fetch(`${API_BASE}/api/confluence/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, title }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Confluence 업로드 실패");
  }

  return res.json();
}

export async function notifySlack(
  markdown: string,
  title: string,
  confluenceUrl?: string,
  indicators?: AnalysisResult["summary"]["indicators"],
  oneLiner?: string,
  insights?: AnalysisResult["summary"]["insights"],
): Promise<SlackResult> {
  const res = await fetch(`${API_BASE}/api/slack/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      markdown,
      title,
      confluence_url: confluenceUrl || "",
      indicators: indicators || [],
      one_liner: oneLiner || "",
      insights: insights || [],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Slack 알림 실패");
  }

  return res.json();
}
