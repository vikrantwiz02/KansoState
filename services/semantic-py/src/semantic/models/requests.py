from pydantic import BaseModel, Field


class EmbedRequest(BaseModel):
    texts: list[str] = Field(..., max_length=64)
    model_hint: str | None = None
    traceparent: str | None = None


class CultureClassifyRequest(BaseModel):
    window: list[str]
    lang_hint: str | None = None
    traceparent: str | None = None
