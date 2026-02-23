#!/usr/bin/env python3
"""
Confluence 업로드 스크립트

마크다운 리포트를 Confluence storage format(XHTML)으로 변환 후 업로드합니다.

환경변수:
    CONFLUENCE_URL       - Confluence 인스턴스 URL (예: https://wantedlab.atlassian.net)
    CONFLUENCE_EMAIL     - Confluence 사용자 이메일
    CONFLUENCE_TOKEN     - Confluence API 토큰
    CONFLUENCE_SPACE_KEY - Confluence 스페이스 키

사용법:
    export CONFLUENCE_URL=https://wantedlab.atlassian.net
    export CONFLUENCE_EMAIL=user@example.com
    export CONFLUENCE_TOKEN=your_api_token
    export CONFLUENCE_SPACE_KEY=HIljcjBpU43a
    python scripts/upload_confluence.py
"""

import os
import re
import sys
import json
import ssl
import urllib.request
import urllib.error
import base64
from pathlib import Path

# ---------------------------------------------------------------------------
# 1. 환경변수 로드
# ---------------------------------------------------------------------------

CONFLUENCE_URL = os.environ.get("CONFLUENCE_URL", "").rstrip("/")
CONFLUENCE_EMAIL = os.environ.get("CONFLUENCE_EMAIL", "")
CONFLUENCE_TOKEN = os.environ.get("CONFLUENCE_TOKEN", "")
CONFLUENCE_SPACE_KEY = os.environ.get("CONFLUENCE_SPACE_KEY", "")
CONFLUENCE_PARENT_ID = os.environ.get("CONFLUENCE_PARENT_ID", "")

PAGE_TITLE = "2026년 1월 실적 분석 & 2월 전망 리포트"

# 마크다운 파일 경로
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
MD_FILE = PROJECT_DIR / "output" / "2026년_1월_월간_채용_분석_리포트.md"


def validate_env():
    """필수 환경변수가 설정되어 있는지 확인합니다."""
    missing = []
    if not CONFLUENCE_URL:
        missing.append("CONFLUENCE_URL")
    if not CONFLUENCE_EMAIL:
        missing.append("CONFLUENCE_EMAIL")
    if not CONFLUENCE_TOKEN:
        missing.append("CONFLUENCE_TOKEN")
    if not CONFLUENCE_SPACE_KEY:
        missing.append("CONFLUENCE_SPACE_KEY")
    if missing:
        print(f"[ERROR] 다음 환경변수가 설정되지 않았습니다: {', '.join(missing)}")
        print()
        print("사용법:")
        print('  export CONFLUENCE_URL="https://wantedlab.atlassian.net"')
        print('  export CONFLUENCE_EMAIL="user@example.com"')
        print('  export CONFLUENCE_TOKEN="your_api_token"')
        print('  export CONFLUENCE_SPACE_KEY="HIljcjBpU43a"')
        print("  python scripts/upload_confluence.py")
        sys.exit(1)


# ---------------------------------------------------------------------------
# 2. Markdown -> Confluence Storage Format 변환
# ---------------------------------------------------------------------------

def convert_markdown_to_confluence(md_text: str) -> str:
    """
    마크다운 텍스트를 Confluence storage format(XHTML)으로 변환합니다.
    Confluence 구조화 매크로를 사용하지 않고 기본 HTML만 사용합니다.
    """
    try:
        import markdown
    except ImportError:
        print("[ERROR] 'markdown' 라이브러리가 설치되어 있지 않습니다.")
        print("  pip install markdown")
        sys.exit(1)

    html = markdown.markdown(
        md_text,
        extensions=["tables", "fenced_code"],
        output_format="html",
    )

    # 코드 블록 → 스타일된 <pre>
    html = _convert_code_blocks(html)

    # blockquote → 스타일된 <div> 패널
    html = _convert_blockquotes(html)

    # 테이블 스타일 적용
    html = _style_tables(html)

    # <hr> 정리 (기본 HTML 유지)
    html = html.replace("<hr>", "<hr />")

    return html


def _convert_code_blocks(html: str) -> str:
    """<pre><code> 블록을 스타일된 <pre>로 변환합니다."""
    pattern = re.compile(
        r"<pre><code(?:\s+class=\"language-(\w+)\")?\s*>(.*?)</code></pre>",
        re.DOTALL,
    )

    def _replacer(match):
        code = match.group(2)
        code = code.replace("&amp;", "&")
        code = code.replace("&lt;", "<")
        code = code.replace("&gt;", ">")
        code = code.replace("&quot;", '"')
        code = code.replace("&#x27;", "'")

        return (
            '<pre style="background-color: #f4f5f7; border: 1px solid #dfe1e6; '
            'border-radius: 3px; padding: 12px; overflow-x: auto; '
            'font-family: SFMono-Medium, Consolas, monospace; font-size: 12px; '
            'line-height: 1.5; white-space: pre-wrap;">'
            f"{code}</pre>"
        )

    return pattern.sub(_replacer, html)


def _convert_blockquotes(html: str) -> str:
    """<blockquote> 블록을 스타일된 <div> 패널로 변환합니다."""
    pattern = re.compile(r"<blockquote>(.*?)</blockquote>", re.DOTALL)

    def _replacer(match):
        content = match.group(1).strip()
        if any(kw in content for kw in ["주의", "Alert", "Warning", "⚠️"]):
            bg = "#FFFAE6"
            border_color = "#FF8B00"
        else:
            bg = "#DEEBFF"
            border_color = "#0052CC"

        return (
            f'<div style="background-color: {bg}; border-left: 4px solid {border_color}; '
            f'padding: 12px 16px; margin: 8px 0; border-radius: 3px;">'
            f"{content}</div>"
        )

    return pattern.sub(_replacer, html)


def _style_tables(html: str) -> str:
    """<table> 태그에 Confluence 친화적 스타일을 추가합니다."""
    html = html.replace(
        "<table>",
        '<table style="border-collapse: collapse;">',
    )

    # <th> 스타일 (배경색 포함)
    html = html.replace(
        "<th>",
        '<th style="background-color: #f4f5f7; border: 1px solid #dfe1e6; '
        'padding: 8px 12px; font-weight: bold; text-align: left;">',
    )
    html = html.replace(
        "<td>",
        '<td style="border: 1px solid #dfe1e6; padding: 8px 12px;">',
    )

    # 정렬 지정된 th/td 처리
    html = re.sub(
        r'<th style="text-align: (\w+);">',
        r'<th style="background-color: #f4f5f7; border: 1px solid #dfe1e6; '
        r'padding: 8px 12px; font-weight: bold; text-align: \1;">',
        html,
    )
    html = re.sub(
        r'<td style="text-align: (\w+);">',
        r'<td style="border: 1px solid #dfe1e6; padding: 8px 12px; '
        r'text-align: \1;">',
        html,
    )

    return html


# ---------------------------------------------------------------------------
# 3. Confluence API 호출
# ---------------------------------------------------------------------------

def _get_ssl_context():
    """SSL 컨텍스트를 생성합니다 (macOS 인증서 이슈 우회)."""
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE
    return ssl_ctx


def _get_auth_headers():
    """Basic Auth 헤더를 생성합니다."""
    credentials = f"{CONFLUENCE_EMAIL}:{CONFLUENCE_TOKEN}"
    b64_credentials = base64.b64encode(credentials.encode("utf-8")).decode("utf-8")
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Basic {b64_credentials}",
    }


def get_existing_page(title: str) -> dict | None:
    """제목으로 기존 페이지를 검색합니다."""
    import urllib.parse
    encoded_title = urllib.parse.quote(title)
    api_url = (
        f"{CONFLUENCE_URL}/wiki/rest/api/content"
        f"?title={encoded_title}&spaceKey={CONFLUENCE_SPACE_KEY}"
        f"&expand=version"
    )

    req = urllib.request.Request(api_url, headers=_get_auth_headers(), method="GET")

    try:
        with urllib.request.urlopen(req, context=_get_ssl_context()) as response:
            data = json.loads(response.read().decode("utf-8"))
            results = data.get("results", [])
            if results:
                return results[0]
    except (urllib.error.HTTPError, urllib.error.URLError):
        pass
    return None


def update_confluence_page(page_id: str, title: str, body_html: str, version: int) -> dict:
    """기존 Confluence 페이지를 업데이트합니다."""
    api_url = f"{CONFLUENCE_URL}/wiki/rest/api/content/{page_id}"

    payload = {
        "type": "page",
        "title": title,
        "space": {"key": CONFLUENCE_SPACE_KEY},
        "body": {
            "storage": {
                "value": body_html,
                "representation": "storage",
            }
        },
        "version": {"number": version + 1},
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(api_url, data=data, headers=_get_auth_headers(), method="PUT")

    try:
        with urllib.request.urlopen(req, context=_get_ssl_context()) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        print(f"[ERROR] Confluence API 호출 실패 (HTTP {e.code})")
        print(f"  URL: {api_url}")
        print(f"  응답: {error_body}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"[ERROR] Confluence 서버에 연결할 수 없습니다.")
        print(f"  URL: {CONFLUENCE_URL}")
        print(f"  원인: {e.reason}")
        sys.exit(1)


def create_confluence_page(title: str, body_html: str) -> dict:
    """
    Confluence 페이지를 생성하거나, 이미 존재하면 업데이트합니다.
    """
    # 기존 페이지 확인
    existing = get_existing_page(title)
    if existing:
        page_id = existing["id"]
        version = existing["version"]["number"]
        print(f"  - 기존 페이지 발견 (ID: {page_id}, v{version}) → 업데이트 진행")
        return update_confluence_page(page_id, title, body_html, version)

    # 새 페이지 생성
    api_url = f"{CONFLUENCE_URL}/wiki/rest/api/content"

    payload = {
        "type": "page",
        "title": title,
        "space": {"key": CONFLUENCE_SPACE_KEY},
        "body": {
            "storage": {
                "value": body_html,
                "representation": "storage",
            }
        },
    }

    if CONFLUENCE_PARENT_ID:
        payload["ancestors"] = [{"id": CONFLUENCE_PARENT_ID}]

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(api_url, data=data, headers=_get_auth_headers(), method="POST")

    try:
        with urllib.request.urlopen(req, context=_get_ssl_context()) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        print(f"[ERROR] Confluence API 호출 실패 (HTTP {e.code})")
        print(f"  URL: {api_url}")
        print(f"  응답: {error_body}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"[ERROR] Confluence 서버에 연결할 수 없습니다.")
        print(f"  URL: {CONFLUENCE_URL}")
        print(f"  원인: {e.reason}")
        sys.exit(1)


# ---------------------------------------------------------------------------
# 4. 메인 실행
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("  Confluence 업로드 스크립트")
    print("=" * 60)
    print()

    # 환경변수 확인
    validate_env()

    # 마크다운 파일 읽기
    if not MD_FILE.exists():
        print(f"[ERROR] 마크다운 파일을 찾을 수 없습니다: {MD_FILE}")
        sys.exit(1)

    print(f"[1/3] 마크다운 파일 읽기: {MD_FILE.name}")
    md_text = MD_FILE.read_text(encoding="utf-8")
    print(f"  - 파일 크기: {len(md_text):,} bytes")
    print(f"  - 줄 수: {md_text.count(chr(10)):,} lines")

    # HTML 변환
    print(f"[2/3] Confluence storage format 변환 중...")
    confluence_html = convert_markdown_to_confluence(md_text)
    print(f"  - 변환 완료: {len(confluence_html):,} bytes")

    # Confluence 업로드
    print(f"[3/3] Confluence 페이지 생성 중...")
    print(f"  - URL: {CONFLUENCE_URL}")
    print(f"  - Space: {CONFLUENCE_SPACE_KEY}")
    print(f"  - Title: {PAGE_TITLE}")
    print()

    result = create_confluence_page(PAGE_TITLE, confluence_html)

    # 결과 출력
    page_id = result.get("id", "")
    page_url = f"{CONFLUENCE_URL}/wiki{result.get('_links', {}).get('webui', '')}"

    print("=" * 60)
    print("  업로드 성공!")
    print("=" * 60)
    print(f"  Page ID: {page_id}")
    print(f"  Page URL: {page_url}")
    print()

    return page_url


if __name__ == "__main__":
    main()
