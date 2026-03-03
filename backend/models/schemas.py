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


class IndicatorItem(BaseModel):
    emoji: str
    metric: str
    result: str
    evaluation: str


class SlackNotifyRequest(BaseModel):
    markdown: str
    confluence_url: str = ""
    title: str
    indicators: list[IndicatorItem] = []
    one_liner: str = ""


class SlackNotifyResponse(BaseModel):
    message_ts: str
