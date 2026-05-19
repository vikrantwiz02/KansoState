from functools import lru_cache
from typing import Annotated

from fastapi import Depends

from semantic.settings import Settings, get_settings


@lru_cache(maxsize=1)
def _make_embedder(  # type: ignore[return]
    provider: str, model_name: str, model_hash: str, openai_key: str, openai_model: str
):
    if provider == "onnx":
        from semantic.embeddings.onnx import get_onnx_embedder
        return get_onnx_embedder(model_name)
    if provider == "openai":
        from semantic.embeddings.openai_compat import get_openai_embedder
        return get_openai_embedder(openai_model, openai_key)
    from semantic.embeddings.sentence_transformers import get_embedder
    return get_embedder(model_name, model_hash)


def get_embedder_dep(settings: Annotated[Settings, Depends(get_settings)]):  # type: ignore[return]
    return _make_embedder(
        settings.embedding_provider,
        settings.model_name,
        settings.model_hash,
        settings.openai_api_key,
        settings.openai_embed_model,
    )


@lru_cache(maxsize=1)
def _make_culture_classifier(llm_model: str, api_key: str):  # type: ignore[return]
    if not api_key:
        from semantic.culture.classifier import NoopCultureClassifier
        return NoopCultureClassifier()
    from semantic.culture.classifier import CultureClassifier
    return CultureClassifier(llm_model, api_key)


def get_culture_classifier_dep(settings: Annotated[Settings, Depends(get_settings)]):  # type: ignore[return]
    return _make_culture_classifier(settings.culture_llm_model, settings.openai_api_key)
