"""분석 엔드포인트: 엑셀 업로드 → 리포트 생성."""

import re

import numpy as np
from fastapi import APIRouter, UploadFile, File, Form, HTTPException

from services.excel_service import extract_structured_data
from services.claude_service import generate_report, generate_report_fallback

router = APIRouter()


def _extract_executive_summary(md_text: str) -> tuple[list[dict], str]:
    """마크다운에서 Executive Summary 지표와 한 줄 요약을 추출합니다.
    run_pipeline.py의 extract_executive_summary()를 재사용합니다.
    """
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

    # 한 줄 요약
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


def _extract_top5_insights(md_text: str) -> list[dict]:
    """마크다운에서 Top 5 핵심 인사이트를 추출합니다.

    형식:
    - **🔴 제목**: 현상 설명
      - 원인: ...
      - 액션: ...
    """
    insights = []

    # "Top 5 핵심 인사이트" ~ 다음 ### 섹션까지 추출
    section_match = re.search(
        r"Top\s*5\s*핵심\s*인사이트[^\n]*\n(.*?)(?=\n###\s|\n## |\Z)",
        md_text,
        re.DOTALL,
    )
    if not section_match:
        return insights

    section = section_match.group(1)

    # 각 인사이트 항목 파싱
    # 패턴: - **emoji title**: description
    item_pattern = re.compile(
        r"[-*]\s*\*\*([🔴🟢🟡])\s*(.+?)\*\*:\s*(.+?)$",
        re.MULTILINE,
    )

    items = list(item_pattern.finditer(section))
    for i, m in enumerate(items):
        emoji = m.group(1)
        title = m.group(2).strip()
        description = m.group(3).strip()

        # 해당 항목 이후 ~ 다음 항목 이전까지의 텍스트에서 원인/액션 추출
        start = m.end()
        end = items[i + 1].start() if i + 1 < len(items) else len(section)
        sub = section[start:end]

        cause = ""
        action = ""
        cause_match = re.search(r"원인:\s*(.+?)$", sub, re.MULTILINE)
        action_match = re.search(r"액션:\s*(.+?)$", sub, re.MULTILINE)
        if cause_match:
            cause = cause_match.group(1).strip()
        if action_match:
            action = action_match.group(1).strip()

        insights.append({
            "emoji": emoji,
            "title": title,
            "description": description,
            "cause": cause,
            "action": action,
        })

    return insights[:5]


def _extract_title(md_text: str) -> str:
    """마크다운에서 제목(H1)을 추출합니다."""
    match = re.search(r"^#\s+(.+)$", md_text, re.MULTILINE)
    if match:
        title = match.group(1).strip()
        title = re.sub(r"[^\w\s&·→←↑↓%₩,.()\-+가-힣]", "", title).strip()
        return title
    return "월간 채용 분석 리포트"


def _build_indicators_from_data(summary_raw: dict) -> list[dict]:
    """구조화된 데이터에서 직접 Executive Summary 지표를 생성합니다.

    Gemini 마크다운 파싱 대신 정확한 계산값을 사용합니다.
    """

    def _grade(mom):
        """MoM 기반 등급 (리드타임은 반전)"""
        if np.isnan(mom):
            return "🟡", "Alert"
        if mom > 5:
            return "🟢", "Good"
        if mom < -5:
            return "🔴", "Alert"
        return "🟡", "Alert"

    def _grade_inverted(mom):
        """리드타임은 감소가 긍정, 증가가 부정"""
        if np.isnan(mom):
            return "🟡", "Alert"
        if mom < -5:
            return "🟢", "Good"
        if mom > 5:
            return "🔴", "Alert"
        return "🟡", "Alert"

    metrics = [
        ("총 매출", summary_raw["total_sales"], summary_raw["total_sales_mom"], "원", False),
        ("합격 수", summary_raw["hire_cnt"], summary_raw["hire_mom"], "건", False),
        ("서류통과 수", summary_raw["pass_cnt"], summary_raw["pass_mom"], "건", False),
        ("매치업 수", summary_raw["matchup_cnt"], summary_raw["matchup_mom"], "건", False),
        ("신규기업 가입", summary_raw["new_com_accept"], summary_raw["new_com_mom"], "건", False),
    ]
    if "lead_time" in summary_raw and not np.isnan(summary_raw.get("lead_time", float("nan"))):
        metrics.append(("채용 리드타임", summary_raw["lead_time"], summary_raw.get("lead_time_mom", float("nan")), "일", True))

    indicators = []
    for name, val, mom, unit, inverted in metrics:
        if unit == "원":
            result_str = f"₩{val / 1e8:.1f}억"
        elif unit == "일":
            result_str = f"{val:.1f}일"
        else:
            result_str = f"{val:,.0f}건"

        mom_val = mom if not np.isnan(mom) else 0
        if inverted:
            emoji, grade = _grade_inverted(mom_val)
        else:
            emoji, grade = _grade(mom_val)

        mom_str = f"{mom:+.1f}%" if not np.isnan(mom) else "N/A"
        status = "📈" if mom_val > 0 else ("📉" if mom_val < 0 else "➡️")
        if inverted:
            status = "📉" if mom_val > 0 else ("📈" if mom_val < 0 else "➡️")

        indicators.append({
            "emoji": emoji,
            "metric": name,
            "result": result_str,
            "evaluation": f"{mom_str} {status}",
        })

    return indicators


@router.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    target_month: str = Form(default=""),
    next_month_business_days: int = Form(default=0),
):
    """엑셀 파일을 분석하여 리포트를 생성합니다."""
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="엑셀 파일(.xlsx)만 업로드 가능합니다.")

    file_bytes = await file.read()

    try:
        structured_data = extract_structured_data(
            file_bytes,
            target_month if target_month else None,
            next_month_business_days=next_month_business_days,
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"엑셀 파싱 오류: {str(e)}")

    try:
        markdown = generate_report(structured_data)
    except Exception:
        markdown = generate_report_fallback(structured_data)

    title = _extract_title(markdown)

    # 구조화된 데이터에서 직접 지표 생성 (Gemini 파싱보다 정확)
    indicators = _build_indicators_from_data(structured_data["summary_raw"])

    # 한 줄 요약과 인사이트는 Gemini 마크다운에서 추출
    _, one_liner = _extract_executive_summary(markdown)
    insights = _extract_top5_insights(markdown)

    return {
        "report": {
            "title": title,
            "markdown": markdown,
            "target_month": structured_data["target_month"],
        },
        "summary": {
            "indicators": indicators,
            "one_liner": one_liner,
            "insights": insights,
        },
    }
