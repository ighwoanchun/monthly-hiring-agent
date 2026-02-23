"""Gemini API를 호출하여 분석 리포트를 생성하는 서비스."""

from pathlib import Path

from google import genai

from config import settings

_CLAUDE_MD_PATH = Path(__file__).resolve().parent.parent / "CLAUDE.md"


def _load_system_prompt() -> str:
    """CLAUDE.md를 읽어 시스템 프롬프트를 구성합니다."""
    claude_md = _CLAUDE_MD_PATH.read_text(encoding="utf-8")
    return f"""당신은 채용 플랫폼의 월간 데이터를 분석하는 전문가입니다.
아래 규칙과 리포트 템플릿에 **정확히** 따라 마크다운 리포트를 작성하세요.

## 핵심 규칙
- pass_cnt = '서류통과 수' (합격 아님!). hire_cnt = '합격 수' (최종 합격자)
- 직군별/기업규모별 합계는 반드시 hire_cnt와 일치
- MoM = (당월-전월)/전월×100
- 상태 이모지: >+5% → 📈, <-5% → 📉, 그 외 → ➡️
- TOP 10 외 → "기타*" (각주에 세부 목록), null → "미분류"
- 리드타임 가중평균 = Σ(리드타임×합격수)/Σ합격수
- 볼드 텍스트(**제목:**) 뒤에 리스트나 테이블이 올 때 반드시 빈 줄 추가
- 숫자에 천 단위 콤마 사용 (예: 90,424)
- 합격 수 단위는 "명", 지원 수 단위도 숫자+명

## Executive Summary 테이블 형식 (필수)
| 구분 | 지표 | 결과 | 평가 |
에서 구분은 🟢 Best / 🟢 Good / 🔴 Alert 중 하나.

## 인사이트 작성 규칙
- 각 섹션마다 💡 인사이트 블록 포함
- "수익 기여도:", "리드타임 패턴:", "핵심 고객군:" 등 소제목 + 볼드 키 수치
- 구체적 수치와 → 화살표로 의미 연결 (예: "개발 직군이 전체 합격의 **41%** — 핵심 수익 동력")

---

{claude_md}"""


def _build_user_prompt(structured_data: dict) -> str:
    target_month = structured_data["target_month"]
    # 월 숫자 추출 (예: "2026년 1월" → "1", 익월 "2")
    parts = target_month.replace("년 ", "-").replace("월", "").split("-")
    year = int(parts[0])
    month = int(parts[1])
    next_month = month + 1 if month < 12 else 1
    next_year = year if month < 12 else year + 1
    prev_month_label = f"{month - 1 if month > 1 else 12}월"

    return f"""다음은 {target_month} 채용 데이터 분석 결과입니다.
아래 리포트 템플릿의 모든 섹션을 빠짐없이 작성하세요. 마크다운만 출력하세요.

=== 데이터 ===

{structured_data['summary']}

{structured_data['monthly_kpi']}

{structured_data['revenue_breakdown']}

{structured_data['job_analysis']}

{structured_data['size_analysis']}

{structured_data['leadtime_analysis']}

{structured_data['pipeline_analysis']}

{structured_data['apply_size_analysis']}

{structured_data['conversion_rates']}

{structured_data['pipeline_prediction']}

{structured_data['job_pipeline_trend']}

{f"익월 영업일수: {structured_data['next_month_business_days']}일 (사용자 입력)" if structured_data.get('next_month_business_days') else ""}

=== 리포트 템플릿 (이 구조를 정확히 따르세요) ===

# {target_month} 실적 분석 & {next_month}월 전망 리포트

> **분석 기간**: (최근 4개월 범위)
> **생성 일시**: (오늘 날짜)
> **데이터 소스**: 월통합분석, 지원기준리드타임_raw, 합격기준리드타임_raw

**데이터 구분 가이드**

| 데이터 | 기준 | 분석 목적 | 사용 섹션 |
테이블로 3개 시트 설명

## Part A. 실적 분석 (합격 기준)
> 📌 "{month}월에 합격한 사람들" 중심 — 결과 평가, 성과 분석

### 1. Executive Summary
**{month}월 핵심 성과**

| 구분 | 지표 | 결과 | 평가 |
🟢 Best / 🟢 Good / 🔴 Alert로 6개 지표 (총 매출, 신규기업 가입, 서류통과 수, 합격 수, 매칭 수, 채용 리드타임)

**한 줄 요약**
> 인용 블록으로 핵심 메시지 한 문장

### 2. 월별 핵심 KPI 추이
| 지표 | (4개월 컬럼) | MoM |
총 매출, 합격 수, 서류통과 수, 매칭 수, 신규기업 가입, 일평균 매출 포함. MoM 컬럼에 수치+이모지.

### 3. 매출 구조 분석
**{month}월 매출 구성**

| 매출 유형 | 금액 | 비중 | 전월 대비 |
수수료/정액제/광고/합계. 전월 대비 MoM% 포함.

💡 **인사이트**: 수수료 매출 변화 → 건당 단가 추정, 정액제 비중 변화 분석

### 4. 합격자 분석 (합격기준 데이터)
> 📌 **합격기준리드타임_raw** — {month}월에 실제 합격한 사람들 기준

#### 4-1. 직군별 합격 실적
| 순위 | 직군 | 합격 수 | 평균 리드타임 | 비중 |
TOP 10 + 기타* + 합계. 기타 각주에 세부 직군(건수) 나열.

💡 **직군별 인사이트**
**수익 기여도:** / **리드타임 패턴:** 소제목으로 분석

#### 4-2. 기업 규모별 합격 실적
| 기업 규모 | 합격 수 | 평균 리드타임 | 비중 |
1~4명 ~ 10,001명+ + 미분류 + 합계

💡 **기업규모별 인사이트**
**핵심 고객군:** / **리드타임 패턴:** 소제목으로 분석

#### 4-3. 채용 리드타임 상세
> 📌 데이터 섹션의 "[리드타임 분석 - 단계별 소요 기간]" 테이블을 그대로 사용하세요. 빈 셀 없이 모든 값을 포함하세요.

💡 **리드타임 인사이트**: 60일 돌파 등 핵심 이슈 분석

### 5. 실적 기반 성과 평가
**🟢 긍정 성과**

| 항목 | 수치 | 의미 |
매출 성장, 건당 단가, 신규기업 가입, 개발 직군 집중 등

**🔴 개선 필요**

| 항목 | 수치 | 분석 | 액션 |
합격 수 감소, 매칭 수 급감, 리드타임 급증, 영업·정보보호 90일+ 등

---

## Part B. 파이프라인 분석 (지원 기준)
> 📌 "{month}월에 지원한 사람들" 중심 — 현황 파악, 미래 예측

### 6. 지원 현황 분석 (지원기준 데이터)
> 📌 **지원기준리드타임_raw** — {month}월에 지원한 사람들 기준

#### 6-1. 직군별 지원 현황
| 순위 | 직군 | 지원자 | 서류통과 | 통과율 | 당월합격 | 파이프라인* |
*파이프라인 = 서류통과 - 당월합격 = **{next_month}월 이후 합격 예상 후보군**

💡 **지원 트렌드** ({month}월 vs {prev_month_label})
📈 급증 직군: / 📉 감소 직군: 테이블로 직군별 변화율+의미

#### 6-2. 기업 규모별 지원 현황
| 기업 규모 | 지원자 | 서류통과 | 통과율 | 파이프라인 |

💡 **기업규모별 인사이트**

### 7. 퍼널 전환 분석 & 예측

#### 7-1. 지원 → 합격 전환 분포
> "{month}월 합격자의 45%는 {prev_month_label}에 지원한 사람들"

| 지원 시점 | 합격 전환 비율 | 의미 | 예측 적용 |
당월/전월⭐/전전월/전전전월 행

💡 **핵심 발견**: {next_month}월 합격 예측의 핵심은 {month}월 지원 수

#### 7-2. 서류통과 → 합격 전환 분포
| 서류통과 시점 | 합격 전환 비율 | 누적 | 의미 |
당월/전월⭐/전전월/전전전월 행

💡 **골든타임**: 서류통과 후 1~2개월 내 집중 관리 → 63.5% 전환

#### 7-3. 전환 인사이트 요약
| 발견 | 의미 | 액션 |
합격 선행지표=전월 지원 수, 골든타임=서류통과 후 1개월, 3개월 초과 시 전환율 급감

### 8. {next_month}월 예측 (파이프라인 기반)

#### 8-1. 파이프라인 기반 합격 예측
> 📌 아래 데이터의 수치를 그대로 사용하세요. 임의로 비우지 마세요.
데이터 섹션의 "[파이프라인 기반 합격 예측]" 테이블을 그대로 사용하되, 합계 행 아래에 실제 예상 범위 추가.

> ⚠️ **주의**: 위 수치는 이론적 최대치. 실제로는 (범위) 예상

#### 8-2. 직군별 {next_month}월 파이프라인
> 📌 데이터 섹션의 "[직군별 {next_month}월 파이프라인]" 테이블을 그대로 사용하세요. 트렌드 컬럼을 반드시 포함하세요.

#### 8-3. 시나리오별 {next_month}월 전망
**💰 매출 시나리오**

| 시나리오 | 예측 매출 | 가정 |
🟢 낙관/🟡 기본/🔴 보수

**🏢 합격 시나리오**

| 시나리오 | 예측 합격 | 근거 |
🟢 낙관/🟡 기본/🔴 보수

---

### 9. 리스크 & 기회 요인

**🔴 리스크 요인**

| # | 항목 | 수치 | 영향 | 대응 |
5개 항목 (리드타임, 합격 수, 매칭 수, 영업·정보보호, 영업일 감소 등)

**🟢 기회 요인**

| # | 항목 | 수치 | 활용 방안 |
5개 항목 (매출, 신규기업, 개발 지원자, 서류통과 파이프라인, 신규 수요 등)

### 10. 핵심 액션 아이템

**🔴 Immediate ({next_month}월 내)**

| 우선순위 | 액션 | 대상 | 기대 효과 |
3개 항목

**📈 Short-term (Q1)**

| 우선순위 | 액션 | 대상 | 기대 효과 |
3개 항목

**📊 KPI 모니터링 대시보드**

| 지표 | 현재 | {next_month}월 목표 | 측정 기준 |
전체 리드타임, 서류통과→익월합격 전환율, 매칭→합격 전환율, 신규기업 포지션 등록률

---

**Appendix: 데이터 구조 정리**

A. 데이터 소스별 역할 테이블
B. 합격기준 vs 지원기준 차이 예시 테이블
C. 전환율 참조표
"""


def generate_report(structured_data: dict) -> str:
    """구조화된 데이터를 기반으로 Gemini API에 리포트 생성을 요청합니다."""
    client = genai.Client(api_key=settings.gemini_api_key)

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        config={
            "system_instruction": _load_system_prompt(),
            "max_output_tokens": 16384,
        },
        contents=_build_user_prompt(structured_data),
    )

    return response.text


def generate_report_fallback(structured_data: dict) -> str:
    """API 호출 없이, 추출된 데이터를 조합하여 리포트를 생성합니다."""
    tm = structured_data["target_month"]
    return f"""# {tm} 월간 채용 분석 리포트

## Part A. 실적 분석 (합격기준)

### 1. Executive Summary

{structured_data['summary']}

### 2. 월별 KPI 추이

{structured_data['monthly_kpi']}

### 3. 매출 구조

{structured_data['revenue_breakdown']}

### 4. 합격자 분석

#### 4-1. 직군별

{structured_data['job_analysis']}

#### 4-2. 기업규모별

{structured_data['size_analysis']}

#### 4-3. 리드타임

{structured_data['leadtime_analysis']}

---

## Part B. 파이프라인 분석 (지원기준)

### 6. 지원 현황

{structured_data['apply_size_analysis']}

### 7. 퍼널 전환 분석

{structured_data['pipeline_analysis']}

{structured_data['conversion_rates']}
"""
