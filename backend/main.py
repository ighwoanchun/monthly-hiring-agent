from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers import analysis, confluence, slack

app = FastAPI(title="월간 채용 분석 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analysis.router, prefix="/api")
app.include_router(confluence.router, prefix="/api/confluence")
app.include_router(slack.router, prefix="/api/slack")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
