"""Slack 알림 서비스.

run_pipeline.py의 send_slack_message(), extract_executive_summary() 로직을 재사용합니다.
"""

import re
import json
import ssl
import urllib.request
import urllib.error

from config import settings


def _ssl_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def extract_executive_summary(md_text: str) -> tuple[list[dict], str]:
    """마크다운에서 Executive Summary 지표와 한 줄 요약을 추출합니다."""
    indicators = []

    pat1 = re.compile(
        r"\|\s*(🟢|🔴|🟡)\s*\*\*(\w+)\*\*\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|"
    )
    for m in pat1.finditer(md_text):
        indicators.append({
            "emoji": m.group(1),
            "metric": m.group(3).strip(),
            "result": m.group(4).strip(),
            "evaluation": m.group(5).strip(),
        })

    if not indicators:
        summary_section = re.search(
            r"## 1\.\s*Executive Summary\s*\n(.*?)(?=\n---|\n## )",
            md_text,
            re.DOTALL,
        )
        if summary_section:
            section = summary_section.group(1)
            pat2 = re.compile(
                r"\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([+\-][\d.]+%)\s*\|\s*(📈|📉|➡️)\s*\|"
            )
            for m in pat2.finditer(section):
                emoji_map = {"📈": "🟢", "📉": "🔴", "➡️": "🟡"}
                indicators.append({
                    "emoji": emoji_map.get(m.group(5), "🟡"),
                    "metric": m.group(1).strip(),
                    "result": m.group(2).strip(),
                    "evaluation": f"{m.group(4)} {m.group(5)}",
                })

    one_liner = ""
    patterns = [
        r'한.?줄.?요약.*?\n>\s*\*\*[""\u201c](.+?)[""\u201d]\*\*',
        r'한.?줄.?요약[:\s]*\*?\*?(.+?)(?:\*\*)?$',
    ]
    for pat in patterns:
        m = re.search(pat, md_text, re.MULTILINE)
        if m:
            one_liner = m.group(1).strip().strip("*").strip()
            break

    return indicators, one_liner


def send_message(
    indicators: list[dict],
    one_liner: str,
    confluence_url: str,
    title: str,
) -> str:
    """Slack Block Kit 메시지를 전송합니다.

    Returns:
        message timestamp (ts)
    """
    fields = []
    for ind in indicators:
        fields.append({
            "type": "mrkdwn",
            "text": f"{ind['emoji']} *{ind['metric']}*\n{ind['result']}\n_{ind['evaluation']}_",
        })

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"📊 {title}", "emoji": True},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": "*핵심 성과 (Executive Summary)*"},
        },
    ]

    if fields:
        blocks.append({"type": "section", "fields": fields})

    blocks.append({"type": "divider"})

    if one_liner:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"💬 *한 줄 요약*\n> _{one_liner}_"},
        })
        blocks.append({"type": "divider"})

    if confluence_url:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"📄 *전체 리포트 보기*\n<{confluence_url}|Confluence에서 전체 리포트 확인하기>",
            },
        })

    payload = json.dumps({"channel": settings.slack_channel_id, "blocks": blocks}).encode()
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": f"Bearer {settings.slack_bot_token}",
    }

    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=payload,
        headers=headers,
        method="POST",
    )

    with urllib.request.urlopen(req, context=_ssl_ctx()) as resp:
        result = json.loads(resp.read().decode())
        if not result.get("ok"):
            raise RuntimeError(f"Slack 전송 실패: {result.get('error', 'unknown')}")
        return result["ts"]
