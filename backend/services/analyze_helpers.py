#!/usr/bin/env python3
"""
월간 채용 분석 헬퍼 스크립트
Claude Code 에이전트가 필요시 호출하거나 수정하여 사용
"""

import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime

def load_data(file_path: str) -> tuple:
    """엑셀 파일에서 3개 시트 로드"""
    monthly = pd.read_excel(file_path, sheet_name='월통합분석')
    apply_raw = pd.read_excel(file_path, sheet_name='지원기준리드타임_raw')
    hire_raw = pd.read_excel(file_path, sheet_name='합격기준리드타임_raw')
    
    # 날짜 변환
    monthly['report_month'] = pd.to_datetime(monthly['report_month'])
    apply_raw['apply_month'] = pd.to_datetime(apply_raw['apply_month'])
    hire_raw['hire_month'] = pd.to_datetime(hire_raw['hire_month'])
    
    return monthly, apply_raw, hire_raw


def weighted_avg(group, value_col: str, weight_col: str) -> float:
    """가중평균 계산: Σ(값×가중치) / Σ가중치"""
    valid = group.dropna(subset=[value_col, weight_col])
    if len(valid) == 0 or valid[weight_col].sum() == 0:
        return np.nan
    return (valid[value_col] * valid[weight_col]).sum() / valid[weight_col].sum()


def calc_mom(current: float, previous: float) -> float:
    """MoM 변화율 계산"""
    if previous == 0:
        return np.nan
    return (current - previous) / previous * 100


def get_status_emoji(mom: float) -> str:
    """상태 이모지 반환"""
    if mom > 5:
        return "📈"
    elif mom < -5:
        return "📉"
    return "➡️"


def analyze_by_job(hire_raw: pd.DataFrame, target_month) -> pd.DataFrame:
    """직군별 합격 분석 (합격기준)"""
    data = hire_raw[hire_raw['hire_month'] == target_month].copy()
    data['job_category'] = data['job_category'].fillna('미분류')

    result = data.groupby('job_category').apply(
        lambda g: pd.Series({
            'hire_count': g['hire_count'].sum(),
            'avg_lead_time': weighted_avg(g, 'total_lead_time', 'hire_count')
        }), include_groups=False
    ).reset_index()
    
    result = result.sort_values('hire_count', ascending=False)
    result['ratio'] = result['hire_count'] / result['hire_count'].sum() * 100
    
    return result


def analyze_by_size(hire_raw: pd.DataFrame, target_month) -> pd.DataFrame:
    """기업규모별 합격 분석 (합격기준)"""
    size_order = ['1~4', '5~10', '11~50', '51~200', '201~500',
                  '501~1000', '1001~5000', '5001~10000', '10001~']

    data = hire_raw[hire_raw['hire_month'] == target_month].copy()
    data['company_size'] = data['company_size'].fillna('미분류')

    result = data.groupby('company_size').apply(
        lambda g: pd.Series({
            'hire_count': g['hire_count'].sum(),
            'avg_lead_time': weighted_avg(g, 'total_lead_time', 'hire_count')
        }), include_groups=False
    ).reset_index()
    
    result['order'] = result['company_size'].apply(
        lambda x: size_order.index(x) if x in size_order else 99
    )
    result = result.sort_values('order')
    result['ratio'] = result['hire_count'] / result['hire_count'].sum() * 100
    
    return result


def analyze_pipeline(apply_raw: pd.DataFrame, target_month) -> pd.DataFrame:
    """지원 현황 및 파이프라인 분석 (지원기준)"""
    data = apply_raw[apply_raw['apply_month'] == target_month]
    
    result = data.groupby('job_category').agg({
        'applicant_count': 'sum',
        'doc_pass_count': 'sum',
        'hire_count': 'sum',
    }).reset_index()
    
    # 파이프라인 = 서류통과 - 당월합격
    result['pipeline'] = result['doc_pass_count'] - result['hire_count']
    result['pass_rate'] = result['doc_pass_count'] / result['applicant_count'] * 100
    
    return result.sort_values('applicant_count', ascending=False)


def text_bar_chart(value: float, max_value: float, length: int = 25) -> str:
    """텍스트 바 차트 생성"""
    if pd.isna(value) or max_value == 0:
        return "░" * length
    filled = int((value / max_value) * length)
    return "█" * filled + "░" * (length - filled)


def generate_summary(monthly: pd.DataFrame, target_month) -> dict:
    """Executive Summary용 핵심 지표"""
    current = monthly[monthly['report_month'] == target_month].iloc[0]
    prev_idx = monthly[monthly['report_month'] == target_month].index[0] - 1
    
    if prev_idx >= 0:
        previous = monthly.iloc[prev_idx]
    else:
        previous = current  # 이전 데이터 없으면 동일값
    
    return {
        'total_sales': current['total_sales'],
        'total_sales_mom': calc_mom(current['total_sales'], previous['total_sales']),
        'hire_cnt': current['hire_cnt'],
        'hire_mom': calc_mom(current['hire_cnt'], previous['hire_cnt']),
        'pass_cnt': current['pass_cnt'],
        'pass_mom': calc_mom(current['pass_cnt'], previous['pass_cnt']),
        'matchup_cnt': current['matchup_cnt'],
        'matchup_mom': calc_mom(current['matchup_cnt'], previous['matchup_cnt']),
        'new_com_accept': current['new_com_accept'],
        'new_com_mom': calc_mom(current['new_com_accept'], previous['new_com_accept']),
    }


# 전환율 참조값
CONVERSION_RATES = {
    'apply_to_hire': {
        'current': 0.113,
        'prev_1': 0.452,  # ⭐ 핵심
        'prev_2': 0.258,
        'prev_3': 0.177
    },
    'pass_to_hire': {
        'current': 0.260,
        'prev_1': 0.375,  # ⭐ 골든타임
        'prev_2': 0.140,
        'prev_3': 0.075
    }
}


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python analyze.py <excel_file_path>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    monthly, apply_raw, hire_raw = load_data(file_path)
    
    target_month = monthly['report_month'].max()
    print(f"분석 대상월: {target_month.strftime('%Y년 %m월')}")
    
    # 요약
    summary = generate_summary(monthly, target_month)
    print(f"\n총 매출: ₩{summary['total_sales']/1e8:.1f}억 ({summary['total_sales_mom']:+.1f}%)")
    print(f"합격 수: {summary['hire_cnt']}건 ({summary['hire_mom']:+.1f}%)")
    
    # 직군별
    job_analysis = analyze_by_job(hire_raw, target_month)
    print(f"\n직군별 합격 TOP 5:")
    for _, row in job_analysis.head(5).iterrows():
        print(f"  {row['job_category']}: {row['hire_count']:.0f}명 ({row['ratio']:.1f}%)")
