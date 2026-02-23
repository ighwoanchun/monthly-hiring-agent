from pydantic import BaseModel


class AnalysisResponse(BaseModel):
    report: dict  # { title, markdown, target_month }
    summary: dict  # { indicators, one_liner }


class ConfluenceUploadRequest(BaseModel):
    markdown: str
    title: str


class ConfluenceUploadResponse(BaseModel):
    page_id: str
    page_url: str


class SlackNotifyRequest(BaseModel):
    markdown: str
    confluence_url: str = ""
    title: str


class SlackNotifyResponse(BaseModel):
    message_ts: str
