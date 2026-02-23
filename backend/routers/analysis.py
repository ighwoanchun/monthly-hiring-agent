"""분석 엔드포인트: 엑셀 업로드 → 리포트 생성."""

import re

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


def _extract_title(md_text: str) -> str:
    """마크다운에서 제목(H1)을 추출합니다."""
    match = re.search(r"^#\s+(.+)$", md_text, re.MULTILINE)
    if match:
        title = match.group(1).strip()
        title = re.sub(r"[^\w\s&·→←↑↓%₩,.()\-+가-힣]", "", title).strip()
        return title
    return "월간 채용 분석 리포트"


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
    indicators, one_liner = _extract_executive_summary(markdown)

    return {
        "report": {
            "title": title,
            "markdown": markdown,
            "target_month": structured_data["target_month"],
        },
        "summary": {
            "indicators": indicators,
            "one_liner": one_liner,
        },
    }
