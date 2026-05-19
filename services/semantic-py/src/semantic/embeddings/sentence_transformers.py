from __future__ import annotations

import hashlib
import os
from functools import lru_cache

from sentence_transformers import SentenceTransformer


class SentenceTransformerEmbedder:
    """Embedder backed by a locally-loaded sentence-transformers model."""

    def __init__(self, model_name: str, expected_hash: str = "") -> None:
        self._model_name = model_name
        self._model = SentenceTransformer(model_name)
        if expected_hash:
            self._verify_hash(expected_hash)

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        vecs = self._model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        return [v.tolist() for v in vecs]

    @property
    def model_id(self) -> str:
        return self._model_name

    def _verify_hash(self, expected: str) -> None:
        # hash the model's config.json as a lightweight drift check
        config_path = os.path.join(
            os.path.expanduser("~/.cache/huggingface/hub"),
            self._model_name.replace("/", "--"),
            "config.json",
        )
        if not os.path.exists(config_path):
            return
        actual = hashlib.sha256(open(config_path, "rb").read()).hexdigest()
        if actual != expected:
            raise RuntimeError(
                f"Model hash mismatch for {self._model_name}: "
                f"expected {expected}, got {actual}. Pin updated?"
            )


@lru_cache(maxsize=1)
def get_embedder(model_name: str, expected_hash: str = "") -> SentenceTransformerEmbedder:
    return SentenceTransformerEmbedder(model_name, expected_hash)
