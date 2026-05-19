from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    embedding_provider: str = Field(default="sentence_transformers", alias="EMBEDDING_PROVIDER")
    model_name: str = Field(default="all-MiniLM-L6-v2", alias="MODEL_NAME")
    # Pin model hash to detect drift between deployments
    model_hash: str = Field(default="", alias="MODEL_HASH")

    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    openai_embed_model: str = Field(default="text-embedding-3-small", alias="OPENAI_EMBED_MODEL")

    # culture classifier is called at most once per meeting per N seconds
    culture_window_seconds: int = Field(default=30, alias="CULTURE_WINDOW_SECONDS")
    culture_llm_model: str = Field(default="gpt-4o-mini", alias="CULTURE_LLM_MODEL")

    max_batch_size: int = Field(default=64, alias="MAX_BATCH_SIZE")
    log_level: str = Field(default="info", alias="LOG_LEVEL")
    port: int = Field(default=8090, alias="PORT")


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
