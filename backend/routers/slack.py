"""Slack 알림 엔드포인트."""

from fastapi import APIRouter, HTTPException

from models.schemas import SlackNotifyRequest, SlackNotifyResponse
from services.slack_service import extract_executive_summary, send_message

router = APIRouter()


@router.post("/notify", response_model=SlackNotifyResponse)
async def notify_slack(req: SlackNotifyRequest):
    """Slack으로 리포트 요약을 전송합니다."""
    try:
        indicators, one_liner = extract_executive_summary(req.markdown)
        ts = send_message(indicators, one_liner, req.confluence_url, req.title)
        return SlackNotifyResponse(message_ts=ts)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Slack 전송 실패: {str(e)}")
