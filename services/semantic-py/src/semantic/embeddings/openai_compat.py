"""OpenAI-compatible embedder adapter, enabled via EMBEDDING_PROVIDER=openai."""
from __future__ import annotations

from functools import lru_cache

import openai


class OpenAIEmbedder:
    def __init__(self, model: str, api_key: str) -> None:
        self._model = model
        self._client = openai.OpenAI(api_key=api_key)

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        resp = self._client.embeddings.create(model=self._model, input=texts)
        return [item.embedding for item in sorted(resp.data, key=lambda x: x.index)]

    @property
    def model_id(self) -> str:
        return self._model


@lru_cache(maxsize=1)
def get_openai_embedder(model: str, api_key: str) -> OpenAIEmbedder:
    return OpenAIEmbedder(model, api_key)
