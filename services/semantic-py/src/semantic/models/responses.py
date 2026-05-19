from pydantic import BaseModel


class EmbedResponse(BaseModel):
    vectors: list[list[float]]
    model: str
    took_ms: int


class CultureClassifyResponse(BaseModel):
    tags: list[str]
    bridge_note: str | None
    took_ms: int
