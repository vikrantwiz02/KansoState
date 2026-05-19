import time
from typing import Annotated

from fastapi import APIRouter, Depends

from semantic.api.deps import get_culture_classifier_dep
from semantic.infra.metrics import culture_latency_ms, culture_requests_total
from semantic.models.requests import CultureClassifyRequest
from semantic.models.responses import CultureClassifyResponse

router = APIRouter()


@router.post("/classify-culture", response_model=CultureClassifyResponse)
async def classify_culture(
    req: CultureClassifyRequest,
    classifier: Annotated[object, Depends(get_culture_classifier_dep)],
) -> CultureClassifyResponse:
    culture_requests_total.inc()
    start = time.monotonic()

    # Use a stable meeting ID derived from the first utterance as a cache key.
    # The real meeting ID would be passed by Sentinel in production.
    meeting_key = req.traceparent or (req.window[0][:16] if req.window else "unknown")

    tags, bridge_note = classifier.classify(  # type: ignore[attr-defined]
        meeting_id=meeting_key,
        window=req.window,
        lang_hint=req.lang_hint,
    )
    took = int((time.monotonic() - start) * 1000)
    culture_latency_ms.observe(took)

    return CultureClassifyResponse(tags=tags, bridge_note=bridge_note, took_ms=took)
