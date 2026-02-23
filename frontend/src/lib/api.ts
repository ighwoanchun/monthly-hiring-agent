const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
  };
}

export interface ConfluenceResult {
  page_id: string;
  page_url: string;
}

export interface SlackResult {
  message_ts: string;
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

  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "분석 실패");
  }

  return res.json();
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
  confluenceUrl?: string
): Promise<SlackResult> {
  const res = await fetch(`${API_BASE}/api/slack/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      markdown,
      title,
      confluence_url: confluenceUrl || "",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Slack 알림 실패");
  }

  return res.json();
}
