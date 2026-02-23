"""Confluence 업로드 서비스.

run_pipeline.py와 upload_confluence.py의 로직을 재사용합니다.
"""

import re
import json
import ssl
import base64
import urllib.request
import urllib.parse
import urllib.error

import markdown as md_lib

from config import settings


def _ssl_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _headers():
    cred = base64.b64encode(
        f"{settings.confluence_email}:{settings.confluence_token}".encode()
    ).decode()
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Basic {cred}",
    }


def convert_markdown_to_confluence(md_text: str) -> str:
    """마크다운을 Confluence storage format HTML로 변환합니다."""
    html = md_lib.markdown(md_text, extensions=["tables", "fenced_code"])

    # 코드 블록
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

    # blockquote
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


def find_page(title: str) -> dict | None:
    """제목으로 기존 페이지를 검색합니다."""
    encoded = urllib.parse.quote(title)
    url = (
        f"{settings.confluence_url}/wiki/rest/api/content"
        f"?title={encoded}&spaceKey={settings.confluence_space_key}&expand=version"
    )
    req = urllib.request.Request(url, headers=_headers())
    try:
        with urllib.request.urlopen(req, context=_ssl_ctx()) as resp:
            data = json.loads(resp.read().decode())
            results = data.get("results", [])
            return results[0] if results else None
    except (urllib.error.HTTPError, urllib.error.URLError):
        return None


def upload(title: str, body_html: str) -> tuple[str, str]:
    """Confluence 페이지를 생성하거나 업데이트합니다.

    Returns:
        (page_id, page_url)
    """
    headers = _headers()
    ctx = _ssl_ctx()

    existing = find_page(title)

    if existing:
        page_id = existing["id"]
        version = existing["version"]["number"]
        url = f"{settings.confluence_url}/wiki/rest/api/content/{page_id}"
        payload = {
            "type": "page",
            "title": title,
            "space": {"key": settings.confluence_space_key},
            "body": {"storage": {"value": body_html, "representation": "storage"}},
            "version": {"number": version + 1},
        }
        method = "PUT"
    else:
        url = f"{settings.confluence_url}/wiki/rest/api/content"
        payload = {
            "type": "page",
            "title": title,
            "space": {"key": settings.confluence_space_key},
            "body": {"storage": {"value": body_html, "representation": "storage"}},
        }
        if settings.confluence_parent_id:
            payload["ancestors"] = [{"id": settings.confluence_parent_id}]
        method = "POST"

    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    with urllib.request.urlopen(req, context=ctx) as resp:
        result = json.loads(resp.read().decode())
        page_id = result["id"]
        page_url = f"{settings.confluence_url}/wiki{result.get('_links', {}).get('webui', '')}"
        return page_id, page_url
