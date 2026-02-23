"""Confluence 업로드 엔드포인트."""

from fastapi import APIRouter, HTTPException

from models.schemas import ConfluenceUploadRequest, ConfluenceUploadResponse
from services.confluence_service import convert_markdown_to_confluence, upload

router = APIRouter()


@router.post("/upload", response_model=ConfluenceUploadResponse)
async def upload_to_confluence(req: ConfluenceUploadRequest):
    """마크다운 리포트를 Confluence에 업로드합니다."""
    try:
        body_html = convert_markdown_to_confluence(req.markdown)
        page_id, page_url = upload(req.title, body_html)
        return ConfluenceUploadResponse(page_id=page_id, page_url=page_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Confluence 업로드 실패: {str(e)}")
