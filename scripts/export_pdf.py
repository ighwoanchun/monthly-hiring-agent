#!/usr/bin/env python3
"""
Confluence 리포트 PDF 아카이브 스크립트

Confluence에 업로드된 페이지를 그대로 가져와 PDF로 렌더링하고
archive/pdf/ 에 월별로 누적 저장합니다. (과거 리포트를 AI가 참조할
"압축된 지식 베이스"로 쌓아두기 위한 용도 — raw 데이터가 아니라
이미 집계·서술된 리포트 결과물을 PDF화합니다.)

의존성: 로컬에 설치된 Google Chrome (headless print-to-pdf 사용,
        별도 패키지 설치 불필요)

사용법:
    python scripts/export_pdf.py --page-id 4866899986 --month 2026-06
    python scripts/export_pdf.py --title "2026년 6월 실적 분석 & 7월 전망 리포트" --month 2026-06
"""

import os
import re
import sys
import json
import ssl
import shutil
import base64
import subprocess
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
ENV_FILE = PROJECT_DIR / ".env"
ARCHIVE_DIR = PROJECT_DIR / "archive" / "pdf"

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    shutil.which("google-chrome") or "",
    shutil.which("chromium") or "",
]


def load_env():
    if not ENV_FILE.exists():
        return
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = value


load_env()

CONFLUENCE_URL = os.environ.get("CONFLUENCE_URL", "").rstrip("/")
CONFLUENCE_EMAIL = os.environ.get("CONFLUENCE_EMAIL", "")
CONFLUENCE_TOKEN = os.environ.get("CONFLUENCE_TOKEN", "")
CONFLUENCE_SPACE_KEY = os.environ.get("CONFLUENCE_SPACE_KEY", "")


def _ssl_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _headers():
    cred = base64.b64encode(f"{CONFLUENCE_EMAIL}:{CONFLUENCE_TOKEN}".encode()).decode()
    return {"Accept": "application/json", "Authorization": f"Basic {cred}"}


def find_chrome() -> str:
    for path in CHROME_CANDIDATES:
        if path and Path(path).exists():
            return path
    print("[ERROR] Chrome/Chromium 실행파일을 찾을 수 없습니다. PDF 변환을 진행할 수 없습니다.")
    sys.exit(1)


def find_page_by_title(title: str) -> dict | None:
    encoded = urllib.parse.quote(title)
    url = (
        f"{CONFLUENCE_URL}/wiki/rest/api/content"
        f"?title={encoded}&spaceKey={CONFLUENCE_SPACE_KEY}&expand=body.storage,version"
    )
    req = urllib.request.Request(url, headers=_headers())
    with urllib.request.urlopen(req, context=_ssl_ctx()) as resp:
        data = json.loads(resp.read().decode())
        results = data.get("results", [])
        return results[0] if results else None


def get_page_by_id(page_id: str) -> dict:
    url = f"{CONFLUENCE_URL}/wiki/rest/api/content/{page_id}?expand=body.storage,version"
    req = urllib.request.Request(url, headers=_headers())
    with urllib.request.urlopen(req, context=_ssl_ctx()) as resp:
        return json.loads(resp.read().decode())


def wrap_html(title: str, body_storage_html: str) -> str:
    """Confluence storage HTML을 인쇄 가능한 단독 HTML 문서로 감쌉니다."""
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  @page {{ size: A4; margin: 18mm 14mm; }}
  body {{
    font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif;
    font-size: 12px;
    line-height: 1.55;
    color: #172B4D;
  }}
  h1 {{ font-size: 22px; border-bottom: 2px solid #dfe1e6; padding-bottom: 8px; }}
  h2 {{ font-size: 17px; margin-top: 28px; }}
  h3 {{ font-size: 14px; margin-top: 20px; }}
  table {{ width: 100%; border-collapse: collapse; margin: 10px 0; page-break-inside: avoid; }}
  th, td {{ border: 1px solid #dfe1e6; padding: 6px 10px; font-size: 11px; }}
  th {{ background-color: #f4f5f7; }}
  hr {{ border: none; border-top: 1px solid #dfe1e6; margin: 20px 0; }}
</style>
</head>
<body>
<h1>{title}</h1>
{body_storage_html}
</body>
</html>"""


def render_pdf(html_path: Path, pdf_path: Path):
    chrome = find_chrome()
    cmd = [
        chrome,
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        f"--print-to-pdf={pdf_path}",
        "--no-pdf-header-footer",
        f"file://{html_path}",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0 or not pdf_path.exists():
        print(f"[ERROR] PDF 렌더링 실패: {result.stderr[:300]}")
        sys.exit(1)


def main():
    import argparse
    import tempfile

    parser = argparse.ArgumentParser(description="Confluence 페이지 → PDF 아카이브")
    parser.add_argument("--page-id", help="Confluence page ID")
    parser.add_argument("--title", help="Confluence page 제목 (page-id 없을 때 검색)")
    parser.add_argument("--month", required=True, help="아카이브 파일명에 쓸 기준월 (예: 2026-06)")
    args = parser.parse_args()

    missing = [k for k in ["CONFLUENCE_URL", "CONFLUENCE_EMAIL", "CONFLUENCE_TOKEN", "CONFLUENCE_SPACE_KEY"] if not os.environ.get(k)]
    if missing:
        print(f"[ERROR] 환경변수 누락: {', '.join(missing)}")
        sys.exit(1)

    if args.page_id:
        page = get_page_by_id(args.page_id)
    elif args.title:
        page = find_page_by_title(args.title)
        if not page:
            print(f"[ERROR] 제목으로 페이지를 찾을 수 없습니다: {args.title}")
            sys.exit(1)
    else:
        print("[ERROR] --page-id 또는 --title 중 하나는 필요합니다.")
        sys.exit(1)

    title = page["title"]
    body_html = page["body"]["storage"]["value"]
    print(f"  페이지: {title} (v{page['version']['number']})")

    full_html = wrap_html(title, body_html)

    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    pdf_path = ARCHIVE_DIR / f"{args.month}.pdf"

    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
        f.write(full_html)
        html_path = Path(f.name)

    try:
        render_pdf(html_path, pdf_path)
    finally:
        html_path.unlink(missing_ok=True)

    print(f"  ✅ PDF 아카이브 완료: {pdf_path.relative_to(PROJECT_DIR)} ({pdf_path.stat().st_size:,} bytes)")
    return pdf_path


if __name__ == "__main__":
    main()
