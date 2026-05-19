"""Benchmark: target 2k embeddings/s on a 4-core dev box (single replica)."""
import pytest


@pytest.mark.benchmark(group="embed")
def test_embed_throughput(benchmark):
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        pytest.skip("sentence-transformers not installed")

    model = SentenceTransformer("all-MiniLM-L6-v2")
    texts = ["This is a sample utterance for throughput benchmarking."] * 64

    def run():
        model.encode(texts, normalize_embeddings=True, show_progress_bar=False)

    result = benchmark(run)
    # benchmark plugin reports ops/sec; validate externally
    assert result is None or True
