"""Contract tests for the embed endpoint."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings as hy_settings
from hypothesis import strategies as st

from semantic.main import app
from semantic.api import deps


@pytest.fixture()
def mock_embedder(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    embedder = MagicMock()
    embedder.model_id = "test-model"
    embedder.embed = lambda texts: [[0.1] * 384 for _ in texts]
    monkeypatch.setattr(deps, "_make_embedder", lambda *_: embedder)
    return embedder


@pytest.fixture()
def client(mock_embedder: MagicMock) -> TestClient:
    return TestClient(app)


def test_embed_returns_vectors(client: TestClient) -> None:
    resp = client.post("/embed", json={"texts": ["hello world", "foo bar"]})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["vectors"]) == 2
    assert len(body["vectors"][0]) == 384
    assert body["model"] == "test-model"
    assert body["took_ms"] >= 0


def test_embed_empty_batch(client: TestClient) -> None:
    resp = client.post("/embed", json={"texts": []})
    assert resp.status_code == 200
    assert resp.json()["vectors"] == []


def test_embed_batch_too_large(client: TestClient) -> None:
    resp = client.post("/embed", json={"texts": ["x"] * 65})
    assert resp.status_code == 400


@hy_settings(max_examples=50)
@given(texts=st.lists(st.text(max_size=200), min_size=1, max_size=10))
def test_embed_hypothesis(client: TestClient, texts: list[str]) -> None:
    resp = client.post("/embed", json={"texts": texts})
    assert resp.status_code == 200
    assert len(resp.json()["vectors"]) == len(texts)


def test_healthz(client: TestClient) -> None:
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_metrics_endpoint(client: TestClient) -> None:
    resp = client.get("/metrics")
    assert resp.status_code == 200
    assert b"kanso_semantic_embed" in resp.content
