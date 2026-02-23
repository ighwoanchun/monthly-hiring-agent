#!/usr/bin/env python3
"""
월간 채용 리포트 자동화 파이프라인

1. 마크다운 리포트 → Confluence 업로드 (생성 또는 업데이트)
2. Executive Summary 추출 → Slack 알림

사용법:
    # .env 파일 설정 후 실행
    python scripts/run_pipeline.py

    # 특정 리포트 파일 지정
    python scripts/run_pipeline.py --file output/2026년_1월_월간_채용_분석_리포트.md
"""

import os
import re
import sys
import json
import ssl
import urllib.request
import urllib.error
import base64
import glob
from pathlib import Path

# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
ENV_FILE = PROJECT_DIR / ".env"


def load_env():
    """프로젝트 루트의 .env 파일에서 환경변수를 로드합니다."""
    if not ENV_FILE.exists():
        return
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip("\"'")
                if key and key not in os.environ:
                    os.environ[key] = value


load_env()

# Confluence 설정
CONFLUENCE_URL = os.environ.get("CONFLUENCE_URL", "").rstrip("/")
CONFLUENCE_EMAIL = os.environ.get("CONFLUENCE_EMAIL", "")
CONFLUENCE_TOKEN = os.environ.get("CONFLUENCE_TOKEN", "")
CONFLUENCE_SPACE_KEY = os.environ.get("CONFLUENCE_SPACE_KEY", "")
CONFLUENCE_PARENT_ID = os.environ.get("CONFLUENCE_PARENT_ID", "")

# Slack 설정
SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN", "")
SLACK_CHANNEL_ID = os.environ.get("SLACK_CHANNEL_ID", "")


def validate_config():
    """필수 설정값이 있는지 확인합니다."""
    errors = []
    if not CONFLUENCE_URL:
        errors.append("CONFLUENCE_URL")
    if not CONFLUENCE_EMAIL:
        errors.append("CONFLUENCE_EMAIL")
    if not CONFLUENCE_TOKEN:
        errors.append("CONFLUENCE_TOKEN")
    if not CONFLUENCE_SPACE_KEY:
        errors.append("CONFLUENCE_SPACE_KEY")
    if not SLACK_BOT_TOKEN:
        errors.append("SLACK_BOT_TOKEN")
    if not SLACK_CHANNEL_ID:
        errors.append("SLACK_CHANNEL_ID")
    if errors:
        print(f"[ERROR] 다음 설정이 누락되었습니다: {', '.join(errors)}")
        print(f"  .env 파일을 확인하세요: {ENV_FILE}")
        sys.exit(1)


# ---------------------------------------------------------------------------
# 유틸리티
# ---------------------------------------------------------------------------

def _ssl_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _confluence_headers():
    cred = base64.b64encode(
        f"{CONFLUENCE_EMAIL}:{CONFLUENCE_TOKEN}".encode()
    ).decode()
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Basic {cred}",
    }


def find_latest_report(report_path=None):
    """가장 최근 리포트 파일을 찾습니다."""
    if report_path:
        p = Path(report_path)
        if not p.is_absolute():
            p = PROJECT_DIR / p
        if p.exists():
            return p
        print(f"[ERROR] 파일을 찾을 수 없습니다: {p}")
        sys.exit(1)

    output_dir = PROJECT_DIR / "output"
    md_files = sorted(output_dir.glob("*.md"), key=lambda f: f.stat().st_mtime, reverse=True)
    if not md_files:
        print(f"[ERROR] output/ 디렉토리에 마크다운 파일이 없습니다.")
        sys.exit(1)
    return md_files[0]


def extract_title(md_text):
    """마크다운에서 페이지 제목(첫 번째 H1)을 추출합니다."""
    match = re.search(r"^#\s+(.+)$", md_text, re.MULTILINE)
    if match:
        title = match.group(1).strip()
        # 이모지 제거
        title = re.sub(r"[^\w\s&·→←↑↓%₩,.()\-+가-힣]", "", title).strip()
        return title
    return "월간 채용 분석 리포트"


# ---------------------------------------------------------------------------
# Step 1: Markdown → Confluence HTML 변환
# ---------------------------------------------------------------------------

def convert_markdown_to_confluence(md_text):
    """마크다운을 Confluence storage format으로 변환합니다."""
    try:
        import markdown
    except ImportError:
        print("[ERROR] 'markdown' 패키지가 필요합니다: pip install markdown")
        sys.exit(1)

    html = markdown.markdown(md_text, extensions=["tables", "fenced_code"])

    # 코드 블록 → 스타일된 <pre>
    html = re.sub(
        r"<pre><code(?:\s+class=\"language-(\w+)\")?\s*>(.*?)</code></pre>",
        lambda m: (
            '<pre style="background-color: #f4f5f7; border: 1px solid #dfe1e6; '
            'border-radius: 3px; padding: 12px; overflow-x: auto; '
            'font-family: SFMono-Medium, Consolas, monospace; font-size: 12px; '
            'line-height: 1.5; white-space: pre-wrap;">'
            + m.group(2)
              .replace("&amp;", "&").replace("&lt;", "<")
              .replace("&gt;", ">").replace("&quot;", '"')
            + "</pre>"
        ),
        html,
        flags=re.DOTALL,
    )

    # blockquote → 스타일된 패널
    def _bq_replacer(m):
        content = m.group(1).strip()
        if any(kw in content for kw in ["주의", "⚠️", "Warning"]):
            bg, border = "#FFFAE6", "#FF8B00"
        else:
            bg, border = "#DEEBFF", "#0052CC"
        return (
            f'<div style="background-color: {bg}; border-left: 4px solid {border}; '
            f'padding: 12px 16px; margin: 8px 0; border-radius: 3px;">'
            f'{content}</div>'
        )

    html = re.sub(r"<blockquote>(.*?)</blockquote>", _bq_replacer, html, flags=re.DOTALL)

    # 테이블 스타일
    html = html.replace("<table>", '<table style="border-collapse: collapse;">')
    html = html.replace(
        "<th>",
        '<th style="background-color: #f4f5f7; border: 1px solid #dfe1e6; '
        'padding: 8px 12px; font-weight: bold; text-align: left;">',
    )
    html = html.replace(
        "<td>",
        '<td style="border: 1px solid #dfe1e6; padding: 8px 12px;">',
    )
    html = re.sub(
        r'<th style="text-align: (\w+);">',
        r'<th style="background-color: #f4f5f7; border: 1px solid #dfe1e6; '
        r'padding: 8px 12px; font-weight: bold; text-align: \1;">',
        html,
    )
    html = re.sub(
        r'<td style="text-align: (\w+);">',
        r'<td style="border: 1px solid #dfe1e6; padding: 8px 12px; text-align: \1;">',
        html,
    )

    html = html.replace("<hr>", "<hr />")
    return html


# ---------------------------------------------------------------------------
# Step 2: Confluence 업로드
# ---------------------------------------------------------------------------

def confluence_find_page(title):
    """제목으로 기존 페이지를 검색합니다."""
    import urllib.parse
    encoded = urllib.parse.quote(title)
    url = (
        f"{CONFLUENCE_URL}/wiki/rest/api/content"
        f"?title={encoded}&spaceKey={CONFLUENCE_SPACE_KEY}&expand=version"
    )
    req = urllib.request.Request(url, headers=_confluence_headers())
    try:
        with urllib.request.urlopen(req, context=_ssl_ctx()) as resp:
            data = json.loads(resp.read().decode())
            results = data.get("results", [])
            return results[0] if results else None
    except (urllib.error.HTTPError, urllib.error.URLError):
        return None


def confluence_upload(title, body_html):
    """Confluence 페이지를 생성하거나 업데이트합니다."""
    headers = _confluence_headers()
    ctx = _ssl_ctx()

    existing = confluence_find_page(title)

    if existing:
        # 업데이트
        page_id = existing["id"]
        version = existing["version"]["number"]
        url = f"{CONFLUENCE_URL}/wiki/rest/api/content/{page_id}"
        payload = {
            "type": "page",
            "title": title,
            "space": {"key": CONFLUENCE_SPACE_KEY},
            "body": {"storage": {"value": body_html, "representation": "storage"}},
            "version": {"number": version + 1},
        }
        method = "PUT"
        print(f"  기존 페이지 업데이트 (ID: {page_id}, v{version} → v{version + 1})")
    else:
        # 생성
        url = f"{CONFLUENCE_URL}/wiki/rest/api/content"
        payload = {
            "type": "page",
            "title": title,
            "space": {"key": CONFLUENCE_SPACE_KEY},
            "body": {"storage": {"value": body_html, "representation": "storage"}},
        }
        if CONFLUENCE_PARENT_ID:
            payload["ancestors"] = [{"id": CONFLUENCE_PARENT_ID}]
        method = "POST"
        parent_info = f" (부모: {CONFLUENCE_PARENT_ID})" if CONFLUENCE_PARENT_ID else ""
        print(f"  새 페이지 생성{parent_info}")

    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            result = json.loads(resp.read().decode())
            page_id = result["id"]
            page_url = f"{CONFLUENCE_URL}/wiki{result.get('_links', {}).get('webui', '')}"
            return page_id, page_url
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[ERROR] Confluence API 실패 (HTTP {e.code}): {body}")
        sys.exit(1)


# ---------------------------------------------------------------------------
# Step 3: Executive Summary 추출
# ---------------------------------------------------------------------------

def extract_executive_summary(md_text):
    """마크다운에서 Executive Summary 섹션의 지표들을 추출합니다."""
    indicators = []

    # 형식 1: | 🟢 **Best** | 총 매출 | ₩23.5억 (+9.7%) | 4개월 최고 |
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

    # 형식 2: | 합격 수 | 758명 | 836명 | -9.3% | 📉 |
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

    # 한 줄 요약 추출 (여러 형식 지원)
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


# ---------------------------------------------------------------------------
# Step 4: Slack 메시지 전송
# ---------------------------------------------------------------------------

def send_slack_message(indicators, one_liner, confluence_url, title):
    """Slack Block Kit 메시지를 전송합니다."""
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

    blocks.append({
        "type": "section",
        "text": {
            "type": "mrkdwn",
            "text": f"📄 *전체 리포트 보기*\n<{confluence_url}|Confluence에서 전체 리포트 확인하기>",
        },
    })

    payload = json.dumps({"channel": SLACK_CHANNEL_ID, "blocks": blocks}).encode()
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": f"Bearer {SLACK_BOT_TOKEN}",
    }

    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=payload,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, context=_ssl_ctx()) as resp:
            result = json.loads(resp.read().decode())
            if not result.get("ok"):
                print(f"[ERROR] Slack 전송 실패: {result.get('error', 'unknown')}")
                sys.exit(1)
            return result["ts"]
    except urllib.error.URLError as e:
        print(f"[ERROR] Slack 연결 실패: {e.reason}")
        sys.exit(1)


# ---------------------------------------------------------------------------
# Step 0: Claude Code CLI로 엑셀 분석 → 리포트 생성
# ---------------------------------------------------------------------------

def find_latest_excel():
    """data/ 디렉토리에서 가장 최근 엑셀 파일을 찾습니다."""
    data_dir = PROJECT_DIR / "data"
    xlsx_files = sorted(data_dir.glob("*.xlsx"), key=lambda f: f.stat().st_mtime, reverse=True)
    if not xlsx_files:
        print(f"[ERROR] data/ 디렉토리에 엑셀 파일이 없습니다.")
        sys.exit(1)
    return xlsx_files[0]


def generate_report_with_claude(excel_file, target_month=None):
    """Claude Code CLI를 호출하여 엑셀 데이터를 분석하고 리포트를 생성합니다."""
    import subprocess
    from datetime import datetime

    if target_month is None:
        today = datetime.now()
        if today.month == 1:
            target_month = f"{today.year - 1}년 12월"
        else:
            target_month = f"{today.year}년 {today.month - 1}월"

    output_filename = f"{target_month.replace('년 ', '년_')}_월간_채용_분석_리포트.md"
    output_path = PROJECT_DIR / "output" / output_filename

    prompt = f"""{excel_file.name} 파일을 분석하여 {target_month} 월간 채용 분석 리포트를 만들어줘.

CLAUDE.md에 정의된 리포트 구조(Part A 실적분석 + Part B 파이프라인분석)를 따라서 작성하고,
결과를 output/{output_filename} 에 마크다운으로 저장해줘.

중요:
- pass_cnt는 서류통과(합격 아님), hire_cnt가 합격
- 합격기준 데이터는 Part A, 지원기준 데이터는 Part B
- 직군별/기업규모별 합계는 hire_cnt와 반드시 일치
- 볼드 텍스트(**제목:**) 뒤에 리스트나 테이블이 올 때 반드시 빈 줄 추가
"""

    print(f"  엑셀: {excel_file.name}")
    print(f"  대상월: {target_month}")
    print(f"  출력: {output_filename}")
    print(f"  Claude Code 실행 중... (수 분 소요)")

    result = subprocess.run(
        [
            "claude",
            "-p", prompt,
            "--allowedTools", "Read", "Write", "Edit", "Bash", "Glob", "Grep",
        ],
        cwd=str(PROJECT_DIR),
        capture_output=True,
        text=True,
        timeout=600,
    )

    if result.returncode != 0:
        print(f"[ERROR] Claude Code 실행 실패:")
        print(result.stderr[:500] if result.stderr else "알 수 없는 오류")
        sys.exit(1)

    if not output_path.exists():
        print(f"[ERROR] 리포트 파일이 생성되지 않았습니다: {output_path}")
        print(f"  Claude 응답:\n{result.stdout[:500]}")
        sys.exit(1)

    return output_path


# ---------------------------------------------------------------------------
# 메인 파이프라인
# ---------------------------------------------------------------------------

def main():
    import argparse

    parser = argparse.ArgumentParser(description="월간 채용 리포트 자동화 파이프라인")
    parser.add_argument("--file", "-f", help="기존 리포트 파일 경로 (지정 시 분석 단계 건너뜀)")
    parser.add_argument("--month", "-m", help="분석 대상월 (예: '2026년 1월')")
    parser.add_argument("--skip-analysis", action="store_true", help="리포트 생성 건너뛰고 기존 파일 사용")
    parser.add_argument("--skip-confluence", action="store_true", help="Confluence 업로드 건너뛰기")
    parser.add_argument("--skip-slack", action="store_true", help="Slack 알림 건너뛰기")
    args = parser.parse_args()

    print("=" * 60)
    print("  월간 채용 리포트 자동화 파이프라인")
    print("=" * 60)
    print()

    validate_config()

    # Step 1: 리포트 생성 (Claude Code CLI)
    if args.file or args.skip_analysis:
        report_file = find_latest_report(args.file)
        print(f"[1/5] 기존 리포트 사용: {report_file.name}")
    else:
        print(f"[1/5] 엑셀 분석 → 리포트 생성 (Claude Code)")
        excel_file = find_latest_excel()
        report_file = generate_report_with_claude(excel_file, args.month)
        print(f"  ✅ 리포트 생성 완료: {report_file.name}")
    print()

    # Step 2: 리포트 읽기
    print(f"[2/5] 리포트 읽기: {report_file.name}")
    md_text = report_file.read_text(encoding="utf-8")
    title = extract_title(md_text)
    print(f"  제목: {title}")
    print()

    # Step 3: Confluence 업로드
    confluence_url = ""
    if not args.skip_confluence:
        print(f"[3/5] Confluence 업로드 중...")
        confluence_html = convert_markdown_to_confluence(md_text)
        page_id, confluence_url = confluence_upload(title, confluence_html)
        print(f"  ✅ 완료 — Page ID: {page_id}")
        print(f"  🔗 {confluence_url}")
    else:
        print("[3/5] Confluence 업로드 건너뜀")
    print()

    # Step 4: Executive Summary 추출
    print(f"[4/5] Executive Summary 추출 중...")
    indicators, one_liner = extract_executive_summary(md_text)
    print(f"  지표 {len(indicators)}개 추출")
    if one_liner:
        print(f"  요약: {one_liner[:60]}...")
    print()

    # Step 5: Slack 알림
    if not args.skip_slack:
        print(f"[5/5] Slack 알림 전송 중... (채널: {SLACK_CHANNEL_ID})")
        ts = send_slack_message(indicators, one_liner, confluence_url, title)
        print(f"  ✅ 완료 — ts: {ts}")
    else:
        print("[5/5] Slack 알림 건너뜀")

    print()
    print("=" * 60)
    print("  파이프라인 완료!")
    print("=" * 60)
    if confluence_url:
        print(f"  📄 Confluence: {confluence_url}")
    print(f"  💬 Slack: #{SLACK_CHANNEL_ID}")
    print()


if __name__ == "__main__":
    main()
