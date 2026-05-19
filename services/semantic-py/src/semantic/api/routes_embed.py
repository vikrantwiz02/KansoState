import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from semantic.api.deps import get_embedder_dep
from semantic.infra.metrics import embed_latency_ms, embed_requests_total, embed_texts_per_batch
from semantic.models.requests import EmbedRequest
from semantic.models.responses import EmbedResponse
from semantic.settings import Settings, get_settings

router = APIRouter()


@router.post("/embed", response_model=EmbedResponse)
async def embed(
    req: EmbedRequest,
    embedder: Annotated[object, Depends(get_embedder_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> EmbedResponse:
    if len(req.texts) > settings.max_batch_size:
        raise HTTPException(
            status_code=400,
            detail=f"batch too large: max {settings.max_batch_size}, got {len(req.texts)}",
        )

    embed_requests_total.inc()
    embed_texts_per_batch.observe(len(req.texts))

    start = time.monotonic()
    vectors = embedder.embed(req.texts)  # type: ignore[attr-defined]
    took = int((time.monotonic() - start) * 1000)

    embed_latency_ms.observe(took)
    return EmbedResponse(vectors=vectors, model=embedder.model_id, took_ms=took)  # type: ignore[attr-defined]
