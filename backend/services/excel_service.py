"""엑셀 파일에서 구조화된 텍스트 데이터를 추출하는 서비스."""

from io import BytesIO

import pandas as pd

from services.analyze_helpers import (
    load_data,
    generate_summary,
    analyze_by_job,
    analyze_by_size,
    analyze_pipeline,
    get_status_emoji,
    calc_mom,
    weighted_avg,
    CONVERSION_RATES,
)


def load_data_from_bytes(file_bytes: bytes) -> tuple:
    """업로드된 파일 바이트에서 3개 시트를 로드합니다."""
    buf = BytesIO(file_bytes)
    monthly = pd.read_excel(buf, sheet_name="월통합분석")
    buf.seek(0)
    apply_raw = pd.read_excel(buf, sheet_name="지원기준리드타임_raw")
    buf.seek(0)
    hire_raw = pd.read_excel(buf, sheet_name="합격기준리드타임_raw")

    monthly["report_month"] = pd.to_datetime(monthly["report_month"])
    apply_raw["apply_month"] = pd.to_datetime(apply_raw["apply_month"])
    hire_raw["hire_month"] = pd.to_datetime(hire_raw["hire_month"])

    return monthly, apply_raw, hire_raw


def extract_structured_data(file_bytes: bytes, target_month: str | None = None, *, next_month_business_days: int = 0) -> dict:
    """엑셀에서 모든 분석 데이터를 구조화된 텍스트로 추출합니다.

    Returns:
        {
            "target_month": "2026년 1월",
            "summary": { ... },
            "monthly_kpi": "markdown table string",
            "job_analysis": "markdown table string",
            "size_analysis": "markdown table string",
            "pipeline_analysis": "markdown table string",
            "revenue_breakdown": "markdown table string",
        }
    """
    monthly, apply_raw, hire_raw = load_data_from_bytes(file_bytes)

    # 대상월 결정
    if target_month:
        tm = pd.to_datetime(target_month)
    else:
        tm = monthly["report_month"].max()

    month_label = f"{tm.year}년 {tm.month}월"

    # 1. Executive Summary
    summary = generate_summary(monthly, tm, hire_raw=hire_raw)
    summary_text = _format_summary(summary)

    # 2. 월별 KPI 추이 (최근 4개월)
    monthly_kpi = _format_monthly_kpi(monthly, tm)

    # 3. 매출 구조
    revenue = _format_revenue(monthly, tm)

    # 4. 직군별 합격 분석
    job_df = analyze_by_job(hire_raw, tm)
    job_text = _format_job_analysis(job_df)

    # 5. 기업규모별 합격 분석
    size_df = analyze_by_size(hire_raw, tm)
    size_text = _format_size_analysis(size_df)

    # 6. 리드타임 분석
    leadtime_text = _format_leadtime(hire_raw, tm)

    # 7. 파이프라인 분석
    pipeline_df = analyze_pipeline(apply_raw, tm)
    pipeline_text = _format_pipeline(pipeline_df)

    # 8. 지원기준 기업규모별
    apply_size_text = _format_apply_by_size(apply_raw, tm)

    # 9. 전환율 참조
    conversion_text = _format_conversion_rates()

    # 10. 파이프라인 기반 합격 예측 (8-1용)
    pipeline_prediction = _format_pipeline_prediction(apply_raw, monthly, tm)

    # 11. 직군별 익월 파이프라인 트렌드 (8-2용)
    job_pipeline_trend = _format_job_pipeline_trend(apply_raw, monthly, tm)

    return {
        "target_month": month_label,
        "summary": summary_text,
        "monthly_kpi": monthly_kpi,
        "revenue_breakdown": revenue,
        "job_analysis": job_text,
        "size_analysis": size_text,
        "leadtime_analysis": leadtime_text,
        "pipeline_analysis": pipeline_text,
        "apply_size_analysis": apply_size_text,
        "conversion_rates": conversion_text,
        "pipeline_prediction": pipeline_prediction,
        "job_pipeline_trend": job_pipeline_trend,
        "next_month_business_days": next_month_business_days,
    }


def _format_summary(s: dict) -> str:
    lines = ["[Executive Summary 핵심 지표]"]
    metrics = [
        ("총 매출", s["total_sales"], s["total_sales_mom"], "원"),
        ("합격 수", s["hire_cnt"], s["hire_mom"], "건"),
        ("서류통과 수", s["pass_cnt"], s["pass_mom"], "건"),
        ("매치업 수", s["matchup_cnt"], s["matchup_mom"], "건"),
        ("신규기업 가입", s["new_com_accept"], s["new_com_mom"], "건"),
    ]

    # 리드타임이 있으면 추가
    if "lead_time" in s and not pd.isna(s.get("lead_time")):
        metrics.append(("채용 리드타임", s["lead_time"], s.get("lead_time_mom"), "일"))

    for name, val, mom, unit in metrics:
        emoji = get_status_emoji(mom) if not pd.isna(mom) else "➡️"
        if unit == "원":
            val_str = f"₩{val/1e8:.1f}억"
        elif unit == "일":
            val_str = f"{val:.1f}일"
        else:
            val_str = f"{val:.0f}{unit}"
        mom_str = f"{mom:+.1f}%" if not pd.isna(mom) else "N/A"
        lines.append(f"- {name}: {val_str} (MoM {mom_str}) {emoji}")
    return "\n".join(lines)


def _format_monthly_kpi(monthly: pd.DataFrame, target_month) -> str:
    idx = monthly[monthly["report_month"] == target_month].index[0]
    start = max(0, idx - 3)
    rows = monthly.iloc[start : idx + 1]

    lines = ["[월별 KPI 추이 - 최근 4개월]"]
    lines.append("| 지표 | " + " | ".join(r["report_month"].strftime("%Y-%m") for _, r in rows.iterrows()) + " |")
    lines.append("|---" * (len(rows) + 1) + "|")

    for col, label, fmt in [
        ("hire_cnt", "합격 수", "{:.0f}"),
        ("pass_cnt", "서류통과 수", "{:.0f}"),
        ("matchup_cnt", "매치업 수", "{:.0f}"),
        ("total_sales", "총 매출(억)", "{:.1f}"),
        ("new_com_accept", "신규기업 가입", "{:.0f}"),
    ]:
        vals = []
        for _, r in rows.iterrows():
            v = r[col]
            if col == "total_sales":
                v = v / 1e8
            vals.append(fmt.format(v))
        lines.append(f"| {label} | " + " | ".join(vals) + " |")

    return "\n".join(lines)


def _format_revenue(monthly: pd.DataFrame, target_month) -> str:
    row = monthly[monthly["report_month"] == target_month].iloc[0]
    total = row["total_sales"]

    parts = []
    for col, label in [("recruit_fee", "수수료 매출"), ("flat_rate_fee", "정액제 매출"), ("ad_sales", "광고 매출")]:
        val = row.get(col, 0) or 0
        pct = val / total * 100 if total else 0
        parts.append(f"- {label}: ₩{val/1e8:.1f}억 ({pct:.1f}%)")

    return "[매출 구조]\n" + "\n".join(parts)


def _format_job_analysis(df: pd.DataFrame) -> str:
    lines = ["[직군별 합격 분석]"]
    lines.append("| 직군 | 합격 수 | 비율 | 평균 리드타임 |")
    lines.append("|---|---|---|---|")

    top10 = df.head(10)
    others = df.iloc[10:]

    for _, r in top10.iterrows():
        lt = f"{r['avg_lead_time']:.1f}일" if not pd.isna(r["avg_lead_time"]) else "-"
        lines.append(f"| {r['job_category']} | {r['hire_count']:.0f} | {r['ratio']:.1f}% | {lt} |")

    if len(others) > 0:
        lines.append(f"| 기타 ({len(others)}개 직군) | {others['hire_count'].sum():.0f} | {others['ratio'].sum():.1f}% | - |")

    lines.append(f"| **합계** | **{df['hire_count'].sum():.0f}** | **100%** | |")
    return "\n".join(lines)


def _format_size_analysis(df: pd.DataFrame) -> str:
    lines = ["[기업규모별 합격 분석]"]
    lines.append("| 기업규모 | 합격 수 | 비율 | 평균 리드타임 |")
    lines.append("|---|---|---|---|")

    for _, r in df.iterrows():
        lt = f"{r['avg_lead_time']:.1f}일" if not pd.isna(r["avg_lead_time"]) else "-"
        name = r["company_size"] if r["company_size"] else "미분류"
        lines.append(f"| {name} | {r['hire_count']:.0f} | {r['ratio']:.1f}% | {lt} |")

    lines.append(f"| **합계** | **{df['hire_count'].sum():.0f}** | **100%** | |")
    return "\n".join(lines)


def _format_leadtime(hire_raw: pd.DataFrame, target_month) -> str:
    data = hire_raw[hire_raw["hire_month"] == target_month]
    if data.empty:
        return "[리드타임 분석]\n데이터 없음"

    # 전월 구하기
    prev_month = target_month - pd.DateOffset(months=1)
    prev_data = hire_raw[hire_raw["hire_month"] == prev_month]

    steps = [
        ("lead_time_to_doc_pass", "지원→서류통과"),
        ("lead_time_doc_pass_to_hire", "서류통과→최종합격"),
        ("total_lead_time", "전체 리드타임"),
    ]

    prev_label = f"{prev_month.month}월" if not prev_data.empty else "전월"
    cur_label = f"{target_month.month}월"

    lines = ["[리드타임 분석 - 단계별 소요 기간 (전월 비교)]"]
    lines.append(f"| 단계 | {prev_label} | {cur_label} | 변화 | 상태 |")
    lines.append("|---|---|---|---|---|")

    for col, label in steps:
        cur_val = weighted_avg(data, col, "hire_count")
        prev_val = weighted_avg(prev_data, col, "hire_count") if not prev_data.empty else float("nan")

        cur_str = f"{cur_val:.1f}일" if not pd.isna(cur_val) else "-"
        prev_str = f"{prev_val:.1f}일" if not pd.isna(prev_val) else "-"

        if not pd.isna(cur_val) and not pd.isna(prev_val):
            diff = cur_val - prev_val
            diff_str = f"{diff:+.1f}일"
            emoji = get_status_emoji(calc_mom(cur_val, prev_val))
        else:
            diff_str = "-"
            emoji = "➡️"

        lines.append(f"| {label} | {prev_str} | {cur_str} | {diff_str} | {emoji} |")

    return "\n".join(lines)


def _format_pipeline(df: pd.DataFrame) -> str:
    lines = ["[파이프라인 분석 - 지원기준]"]
    lines.append("| 직군 | 지원 수 | 서류통과 수 | 합격 수 | 파이프라인 | 서류통과율 |")
    lines.append("|---|---|---|---|---|---|")

    top10 = df.head(10)
    for _, r in top10.iterrows():
        lines.append(
            f"| {r['job_category']} | {r['applicant_count']:.0f} | {r['doc_pass_count']:.0f} "
            f"| {r['hire_count']:.0f} | {r['pipeline']:.0f} | {r['pass_rate']:.1f}% |"
        )

    totals = df[["applicant_count", "doc_pass_count", "hire_count", "pipeline"]].sum()
    total_pass_rate = totals["doc_pass_count"] / totals["applicant_count"] * 100 if totals["applicant_count"] else 0
    lines.append(
        f"| **합계** | **{totals['applicant_count']:.0f}** | **{totals['doc_pass_count']:.0f}** "
        f"| **{totals['hire_count']:.0f}** | **{totals['pipeline']:.0f}** | **{total_pass_rate:.1f}%** |"
    )
    return "\n".join(lines)


def _format_apply_by_size(apply_raw: pd.DataFrame, target_month) -> str:
    data = apply_raw[apply_raw["apply_month"] == target_month]
    if data.empty:
        return "[지원기준 기업규모별]\n데이터 없음"

    result = data.groupby("company_size").agg({
        "applicant_count": "sum",
        "doc_pass_count": "sum",
        "hire_count": "sum",
    }).reset_index()
    result["pipeline"] = result["doc_pass_count"] - result["hire_count"]
    result["pass_rate"] = result["doc_pass_count"] / result["applicant_count"] * 100
    result = result.sort_values("applicant_count", ascending=False)

    lines = ["[지원기준 기업규모별 현황]"]
    lines.append("| 기업규모 | 지원자 | 서류통과 | 통과율 | 파이프라인 |")
    lines.append("|---|---|---|---|---|")
    for _, r in result.iterrows():
        name = r["company_size"] if r["company_size"] else "미분류"
        lines.append(
            f"| {name} | {r['applicant_count']:.0f} | {r['doc_pass_count']:.0f} "
            f"| {r['pass_rate']:.1f}% | {r['pipeline']:.0f} |"
        )
    return "\n".join(lines)


def _calc_hire_doc_pass_rate(apply_raw: pd.DataFrame, monthly: pd.DataFrame) -> float:
    """실제 전환율 계산: 월별 hire_cnt / 전월 doc_pass_count 평균."""
    sorted_months = sorted(monthly["report_month"].unique())
    rates = []
    for m in sorted_months:
        hire = monthly[monthly["report_month"] == m]["hire_cnt"].iloc[0]
        prev_m = m - pd.DateOffset(months=1)
        prev_doc = apply_raw[apply_raw["apply_month"] == prev_m]["doc_pass_count"].sum()
        if prev_doc > 0:
            rates.append(hire / prev_doc)
    return sum(rates) / len(rates) if rates else 0.10


def _format_pipeline_prediction(apply_raw: pd.DataFrame, monthly: pd.DataFrame, target_month) -> str:
    """8-1. 파이프라인 기반 합격 예측 — 실제 전환율 사용."""
    next_month_num = target_month.month + 1 if target_month.month < 12 else 1
    avg_rate = _calc_hire_doc_pass_rate(apply_raw, monthly)

    # 각 월의 서류통과 수와 예상 기여분
    dist = CONVERSION_RATES["pass_to_hire"]
    current_hire = monthly[monthly["report_month"] == target_month]["hire_cnt"].iloc[0]

    months_data = []
    for offset, dist_pct in [(0, dist["prev_1"]), (1, dist["prev_2"]), (2, dist["prev_3"])]:
        m = target_month - pd.DateOffset(months=offset)
        data = apply_raw[apply_raw["apply_month"] == m]
        doc_pass = data["doc_pass_count"].sum() if not data.empty else 0
        # 실제 전환율 = (당월합격 × 분포비율) / 해당월 서류통과수
        if doc_pass > 0:
            actual_rate = (current_hire * dist_pct) / doc_pass
        else:
            actual_rate = 0
        expected = doc_pass * actual_rate
        m_label = f"{m.month}월 서류통과→{next_month_num}월"
        months_data.append((m_label, doc_pass, actual_rate * 100, expected))

    # 기본 예측 (전체 전환율 기반)
    cur_doc = apply_raw[apply_raw["apply_month"] == target_month]["doc_pass_count"].sum()
    base_prediction = cur_doc * avg_rate

    # 당월+기타 기여분 추산
    total_from_sources = sum(exp for _, _, _, exp in months_data)
    known_dist = dist["prev_1"] + dist["prev_2"] + dist["prev_3"]
    other_expected = total_from_sources * (1 - known_dist) / known_dist if known_dist > 0 else 0
    total_expected = total_from_sources + other_expected

    lines = [f"[파이프라인 기반 합격 예측 - {next_month_num}월 (기준 전환율 {avg_rate*100:.1f}%)]"]
    lines.append("| 파이프라인 소스 | 서류통과 수 | 실제 전환율 | 예상 기여 합격 |")
    lines.append("|---|---|---|---|")
    for label, qty, rate, exp in months_data:
        lines.append(f"| {label} | {qty:,.0f} | {rate:.1f}% | {exp:,.0f} |")
    lines.append(f"| 당월+기타 소스 (추정) | - | - | {other_expected:,.0f} |")
    lines.append(f"| **합계** | | | **{total_expected:,.0f}** |")

    return "\n".join(lines)


def _format_job_pipeline_trend(apply_raw: pd.DataFrame, monthly: pd.DataFrame, target_month) -> str:
    """8-2. 직군별 익월 파이프라인 + 전월 대비 트렌드."""
    prev_month = target_month - pd.DateOffset(months=1)
    next_month_num = target_month.month + 1 if target_month.month < 12 else 1
    rate = _calc_hire_doc_pass_rate(apply_raw, monthly)

    cur_data = apply_raw[apply_raw["apply_month"] == target_month]
    prev_data = apply_raw[apply_raw["apply_month"] == prev_month]

    cur_by_job = cur_data.groupby("job_category")["doc_pass_count"].sum().reset_index()
    prev_by_job = prev_data.groupby("job_category")["doc_pass_count"].sum().reset_index()

    merged = cur_by_job.merge(prev_by_job, on="job_category", how="left", suffixes=("", "_prev"))
    merged["expected_hire"] = merged["doc_pass_count"] * rate
    merged["mom"] = merged.apply(
        lambda r: calc_mom(r["doc_pass_count"], r["doc_pass_count_prev"])
        if not pd.isna(r.get("doc_pass_count_prev")) and r.get("doc_pass_count_prev", 0) > 0
        else float("nan"),
        axis=1,
    )
    merged = merged.sort_values("doc_pass_count", ascending=False)

    lines = [f"[직군별 {next_month_num}월 파이프라인 (전환율 {rate*100:.1f}%)]"]
    lines.append(f"| 직군 | {target_month.month}월 서류통과 | 예상 {next_month_num}월 합격 | 전월 대비 | 트렌드 |")
    lines.append("|---|---|---|---|---|")

    for _, r in merged.head(10).iterrows():
        doc = f"{r['doc_pass_count']:,.0f}"
        exp = f"{r['expected_hire']:,.0f}"
        if not pd.isna(r["mom"]):
            mom_str = f"{r['mom']:+.1f}%"
            emoji = get_status_emoji(r["mom"])
        else:
            mom_str = "-"
            emoji = "➡️"
        lines.append(f"| {r['job_category']} | {doc} | {exp} | {mom_str} | {emoji} |")

    return "\n".join(lines)


def _format_conversion_rates() -> str:
    lines = ["[전환율 참조값]"]
    ar = CONVERSION_RATES["apply_to_hire"]
    pr = CONVERSION_RATES["pass_to_hire"]
    lines.append(f"지원→합격: 당월 {ar['current']*100:.1f}% / 전월 {ar['prev_1']*100:.1f}% / 전전월 {ar['prev_2']*100:.1f}% / 전전전월 {ar['prev_3']*100:.1f}%")
    lines.append(f"서류통과→합격: 당월 {pr['current']*100:.1f}% / 전월 {pr['prev_1']*100:.1f}% / 전전월 {pr['prev_2']*100:.1f}% / 전전전월 {pr['prev_3']*100:.1f}%")
    return "\n".join(lines)
