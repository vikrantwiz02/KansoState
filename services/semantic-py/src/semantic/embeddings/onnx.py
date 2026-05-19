"""ONNX runtime adapter for ~2x throughput vs vanilla PyTorch."""
from __future__ import annotations

from functools import lru_cache
from typing import Any


class ONNXEmbedder:
    """Wraps optimum's ONNX export of sentence-transformers for faster inference."""

    def __init__(self, model_name: str) -> None:
        try:
            from optimum.onnxruntime import ORTModelForFeatureExtraction
            from transformers import AutoTokenizer
        except ImportError as e:
            raise ImportError(
                "Install the 'onnx' extras: pip install semantic[onnx]"
            ) from e

        self._tokenizer = AutoTokenizer.from_pretrained(model_name)
        self._model: Any = ORTModelForFeatureExtraction.from_pretrained(
            model_name, export=True
        )
        self._model_name = model_name

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        import numpy as np

        inputs = self._tokenizer(
            texts, padding=True, truncation=True, return_tensors="pt"
        )
        outputs = self._model(**inputs)
        # mean pooling
        hidden = outputs.last_hidden_state.detach().numpy()
        mask = inputs["attention_mask"].numpy()[..., None]
        pooled = (hidden * mask).sum(axis=1) / mask.sum(axis=1)
        # L2 normalize
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        pooled = pooled / np.maximum(norms, 1e-12)
        return pooled.tolist()

    @property
    def model_id(self) -> str:
        return f"{self._model_name}[onnx]"


@lru_cache(maxsize=1)
def get_onnx_embedder(model_name: str) -> ONNXEmbedder:
    return ONNXEmbedder(model_name)
