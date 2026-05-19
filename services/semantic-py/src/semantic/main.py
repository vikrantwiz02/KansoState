import logging

import structlog
import uvicorn
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

from semantic.api.routes_classify_culture import router as culture_router
from semantic.api.routes_embed import router as embed_router
from semantic.settings import get_settings

settings = get_settings()

structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(
        getattr(logging, settings.log_level.upper(), logging.INFO)
    ),
)

app = FastAPI(title="Semantic Sidecar", docs_url=None, redoc_url=None)

app.include_router(embed_router)
app.include_router(culture_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/metrics")
async def metrics() -> PlainTextResponse:
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)


if __name__ == "__main__":
    uvicorn.run(
        "semantic.main:app",
        host="0.0.0.0",
        port=settings.port,
        workers=1,
        log_level=settings.log_level.lower(),
    )
