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


def _convert_insights_to_cards(html: str) -> str:
    """Top 5 핵심 인사이트 섹션을 카드 스타일 HTML로 변환합니다.

    markdown 라이브러리가 2칸 들여쓰기 중첩을 flat <li>로 렌더링하므로,
    <strong>+이모지로 시작하는 항목을 제목으로, 원인:/액션: 항목을 하위로 그룹핑합니다.
    """
    pattern = re.compile(
        r"(<(?:h[23]|p)>.*?Top\s*5\s*핵심\s*인사이트.*?</(?:h[23]|p)>)\s*<ul>(.*?)</ul>",
        re.DOTALL,
    )
    match = pattern.search(html)
    if not match:
        return html

    heading = match.group(1)
    list_html = match.group(2)

    # 모든 <li> 항목 추출
    li_items = re.findall(r"<li>(.*?)</li>", list_html, re.DOTALL)

    # 제목 항목(이모지+strong) 기준으로 그룹핑
    groups: list[dict] = []
    for li in li_items:
        text = li.strip()
        if re.search(r"<strong>[🔴🟢🟡]", text):
            groups.append({"title": text, "cause": "", "action": ""})
        elif groups:
            if text.startswith("원인:"):
                groups[-1]["cause"] = text[len("원인:"):].strip()
            elif text.startswith("액션:"):
                groups[-1]["action"] = text[len("액션:"):].strip()

    cards = []
    for g in groups:
        if "🔴" in g["title"]:
            border_color = "#EF4444"
        elif "🟢" in g["title"]:
            border_color = "#22C55E"
        else:
            border_color = "#EAB308"

        card = (
            f'<div style="background-color: #f9fafb; border-left: 4px solid {border_color}; '
            f'border-radius: 4px; padding: 12px 16px; margin: 8px 0;">'
            f'<div style="font-size: 14px;">{g["title"]}</div>'
        )
        sub_items = []
        if g["cause"]:
            sub_items.append(
                f'<li style="color: #4b5563; margin-bottom: 2px;">'
                f'<strong>원인:</strong> {g["cause"]}</li>'
            )
        if g["action"]:
            sub_items.append(
                f'<li style="color: #2563eb; margin-bottom: 2px;">'
                f'<strong>액션:</strong> {g["action"]}</li>'
            )
        if sub_items:
            card += (
                f'<ul style="margin: 6px 0 0 0; padding-left: 20px; font-size: 13px;">'
                + "".join(sub_items)
                + "</ul>"
            )
        card += "</div>"
        cards.append(card)

    replacement = heading + "\n" + "\n".join(cards)
    return html[: match.start()] + replacement + html[match.end() :]


def _normalize_emojis(html: str) -> str:
    """Confluence에서 렌더링되지 않는 이모지 변형을 표준 이모지로 정규화합니다.

    Gemini가 variation selector(VS16, U+FE0F) 등을 포함한 이모지를 출력하면
    Confluence에서 '??'로 표시되는 문제를 방지합니다.
    """
    # variation selector 제거 (U+FE0F, U+FE0E)
    html = html.replace("\ufe0f", "").replace("\ufe0e", "")
    # zero-width joiner 제거 (보이지 않는 결합 문자)
    html = html.replace("\u200d", "")
    return html


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

    # Top 5 핵심 인사이트를 카드 스타일로 변환
    html = _convert_insights_to_cards(html)

    # Confluence에서 렌더링 안 되는 이모지 변형 정규화
    html = _normalize_emojis(html)

    return html


def _verify_auth() -> None:
    """API 토큰 인증이 유효한지 확인합니다."""
    url = f"{settings.confluence_url}/wiki/rest/api/user/current"
    req = urllib.request.Request(url, headers=_headers())
    try:
        with urllib.request.urlopen(req, context=_ssl_ctx()) as resp:
            data = json.loads(resp.read().decode())
            if data.get("type") == "anonymous":
                raise RuntimeError(
                    "Confluence 인증 실패: Anonymous로 인식됨. "
                    "CONFLUENCE_EMAIL과 CONFLUENCE_TOKEN을 확인하세요. "
                    "토큰은 https://id.atlassian.com/manage-profile/security/api-tokens 에서 생성합니다."
                )
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Confluence 인증 확인 실패: {e.code} {e.reason}") from e


def _resolve_space_key() -> str:
    """설정된 space key/id를 실제 사용 가능한 space key로 변환합니다."""
    key = settings.confluence_space_key
    if not key:
        raise RuntimeError("CONFLUENCE_SPACE_KEY가 설정되지 않았습니다.")

    # v1 API로 직접 확인
    url = f"{settings.confluence_url}/wiki/rest/api/space/{urllib.parse.quote(key)}"
    req = urllib.request.Request(url, headers=_headers())
    try:
        with urllib.request.urlopen(req, context=_ssl_ctx()) as resp:
            data = json.loads(resp.read().decode())
            return data["key"]
    except urllib.error.HTTPError:
        pass

    # v2 API로 ID 기반 조회 시도 (숫자인 경우)
    if key.isdigit():
        url = f"{settings.confluence_url}/wiki/api/v2/spaces/{key}"
        req = urllib.request.Request(url, headers=_headers())
        try:
            with urllib.request.urlopen(req, context=_ssl_ctx()) as resp:
                data = json.loads(resp.read().decode())
                return data["key"]
        except urllib.error.HTTPError:
            pass

    raise RuntimeError(
        f"Space '{key}'를 찾을 수 없습니다. "
        "Confluence에서 해당 Space의 Settings → Space details에서 "
        "정확한 Space Key를 확인하세요."
    )


def find_page(title: str, space_key: str) -> dict | None:
    """제목으로 기존 페이지를 검색합니다."""
    encoded = urllib.parse.quote(title)
    url = (
        f"{settings.confluence_url}/wiki/rest/api/content"
        f"?title={encoded}&spaceKey={space_key}&expand=version"
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
    _verify_auth()
    space_key = _resolve_space_key()

    headers = _headers()
    ctx = _ssl_ctx()

    existing = find_page(title, space_key)

    if existing:
        page_id = existing["id"]
        version = existing["version"]["number"]
        url = f"{settings.confluence_url}/wiki/rest/api/content/{page_id}"
        payload = {
            "type": "page",
            "title": title,
            "space": {"key": space_key},
            "body": {"storage": {"value": body_html, "representation": "storage"}},
            "version": {"number": version + 1},
        }
        method = "PUT"
    else:
        url = f"{settings.confluence_url}/wiki/rest/api/content"
        payload = {
            "type": "page",
            "title": title,
            "space": {"key": space_key},
            "body": {"storage": {"value": body_html, "representation": "storage"}},
        }
        if settings.confluence_parent_id:
            payload["ancestors"] = [{"id": settings.confluence_parent_id}]
        method = "POST"

    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            result = json.loads(resp.read().decode())
            page_id = result["id"]
            page_url = f"{settings.confluence_url}/wiki{result.get('_links', {}).get('webui', '')}"
            return page_id, page_url
    except urllib.error.HTTPError as e:
        body = e.read().decode() if hasattr(e, "read") else ""
        raise RuntimeError(
            f"Confluence 페이지 생성/수정 실패: {e.code} {e.reason}. {body[:200]}"
        ) from e
