"""Slack 알림 엔드포인트."""

from fastapi import APIRouter, HTTPException

from models.schemas import SlackNotifyRequest, SlackNotifyResponse
from services.slack_service import extract_executive_summary, send_message

router = APIRouter()


@router.post("/notify", response_model=SlackNotifyResponse)
async def notify_slack(req: SlackNotifyRequest):
    """Slack으로 리포트 요약을 전송합니다."""
    try:
        # 프론트엔드에서 구조화된 indicators를 제공하면 우선 사용
        if req.indicators:
            indicators = [ind.model_dump() for ind in req.indicators]
            one_liner = req.one_liner
        else:
            # fallback: 마크다운에서 파싱
            indicators, one_liner = extract_executive_summary(req.markdown)

        ts = send_message(indicators, one_liner, req.confluence_url, req.title)
        return SlackNotifyResponse(message_ts=ts)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Slack 전송 실패: {str(e)}")
