/**
 * Slack 알림 서비스 — Python slack_service.py 포팅
 */

export interface Indicator {
  emoji: string;
  metric: string;
  result: string;
  evaluation: string;
}

export function extractExecutiveSummary(mdText: string): { indicators: Indicator[]; oneLiner: string } {
  const indicators: Indicator[] = [];

  // 형식 1: | 🟢 **Best** | 총 매출 | ₩23.5억 (+9.7%) | 4개월 최고 |
  const pat1 = /\|\s*(🟢|🔴|🟡)\s*\*\*(\w+)\*\*\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/g;
  let m;
  while ((m = pat1.exec(mdText))) {
    indicators.push({ emoji: m[1], metric: m[3].trim(), result: m[4].trim(), evaluation: m[5].trim() });
  }

  // 형식 2: | 합격 수 | 758명 | 836명 | -9.3% | 📉 |
  if (indicators.length === 0) {
    const sectionMatch = /## 1\.\s*Executive Summary\s*\n(.*?)(?=\n---|\n## )/s.exec(mdText);
    if (sectionMatch) {
      const section = sectionMatch[1];
      const pat2 = /\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([+-][\d.]+%)\s*\|\s*(📈|📉|➡️)\s*\|/g;
      const emojiMap: Record<string, string> = { "📈": "🟢", "📉": "🔴", "➡️": "🟡" };
      while ((m = pat2.exec(section))) {
        indicators.push({
          emoji: emojiMap[m[5]] || "🟡",
          metric: m[1].trim(),
          result: m[2].trim(),
          evaluation: `${m[4]} ${m[5]}`,
        });
      }
    }
  }

  let oneLiner = "";
  const patterns = [/한.?줄.?요약.*?\n>\s*\*\*[""\u201c](.+?)[""\u201d]\*\*/m, /한.?줄.?요약[:\s]*\*?\*?(.+?)(?:\*\*)?$/m];
  for (const pat of patterns) {
    const match = pat.exec(mdText);
    if (match) {
      oneLiner = match[1].trim().replace(/^\*+|\*+$/g, "").trim();
      break;
    }
  }

  return { indicators, oneLiner };
}

export interface Insight {
  emoji: string;
  title: string;
  description: string;
  cause: string;
  action: string;
}

export async function sendSlackMessage(
  indicators: Indicator[],
  oneLiner: string,
  confluenceUrl: string,
  title: string,
  insights?: Insight[],
): Promise<string> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;
  if (!token || !channelId) throw new Error("SLACK_BOT_TOKEN / SLACK_CHANNEL_ID가 설정되지 않았습니다.");

  // Slack Block Kit fields는 최대 10개
  const fields = indicators.map((ind) => ({
    type: "mrkdwn" as const,
    text: `${ind.emoji} *${ind.metric}*\n${ind.result}\n_${ind.evaluation}_`,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: `📊 ${title}`, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: "*핵심 성과 (Executive Summary)*" } },
  ];

  if (fields.length > 0) blocks.push({ type: "section", fields });

  if (oneLiner) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `> _${oneLiner}_` } });
  }

  blocks.push({ type: "divider" });

  // Top 3 핵심 인사이트
  const top3 = (insights || []).slice(0, 3);
  if (top3.length > 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Top 3 핵심 인사이트*" } });
    for (const ins of top3) {
      let text = `${ins.emoji} *${ins.title}* — ${ins.description}`;
      if (ins.cause) text += `\n    _원인: ${ins.cause}_`;
      if (ins.action) text += `\n    _액션: ${ins.action}_`;
      blocks.push({ type: "section", text: { type: "mrkdwn", text } });
    }
    blocks.push({ type: "divider" });
  }

  // Confluence 링크
  if (confluenceUrl) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `📄 <${confluenceUrl}|Confluence에서 전체 리포트 확인하기>` },
    });
  }

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: channelId, blocks }),
  });

  const result = await res.json();
  if (!result.ok) throw new Error(`Slack 전송 실패: ${result.error || "unknown"}`);
  return result.ts;
}
