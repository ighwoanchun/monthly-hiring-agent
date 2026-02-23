from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # Gemini API
    gemini_api_key: str = ""

    # Confluence
    confluence_url: str = ""
    confluence_email: str = ""
    confluence_token: str = ""
    confluence_space_key: str = ""
    confluence_parent_id: str = ""

    # Slack
    slack_bot_token: str = ""
    slack_channel_id: str = ""

    # CORS
    cors_origins: str = "http://localhost:3000"

    # Paths
    project_root: Path = Path(__file__).resolve().parent.parent

    model_config = {
        "env_file": str(Path(__file__).resolve().parent.parent / ".env"),
        "env_file_encoding": "utf-8",
        "env_file_ignore_missing": True,
    }


settings = Settings()
