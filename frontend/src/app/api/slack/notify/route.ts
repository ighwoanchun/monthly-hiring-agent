/**
 * POST /api/slack/notify — Slack 알림 전송
 */

import { NextResponse } from "next/server";
import { extractExecutiveSummary, sendSlackMessage, type Indicator } from "@/lib/services/slack";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { markdown, title, confluence_url = "", indicators: rawIndicators = [], one_liner = "" } = body;

    let indicators: Indicator[];
    let oneLiner: string;

    if (rawIndicators.length > 0) {
      indicators = rawIndicators;
      oneLiner = one_liner;
    } else {
      const extracted = extractExecutiveSummary(markdown);
      indicators = extracted.indicators;
      oneLiner = extracted.oneLiner;
    }

    const ts = await sendSlackMessage(indicators, oneLiner, confluence_url, title);
    return NextResponse.json({ message_ts: ts });
  } catch (e) {
    return NextResponse.json(
      { detail: `Slack 전송 실패: ${e instanceof Error ? e.message : e}` },
      { status: 502 },
    );
  }
}
