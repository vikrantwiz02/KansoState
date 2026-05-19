from prometheus_client import Counter, Histogram

embed_requests_total = Counter(
    "kanso_semantic_embed_requests_total", "Total embedding requests"
)
embed_latency_ms = Histogram(
    "kanso_semantic_embed_latency_ms",
    "Embedding batch latency in milliseconds",
    buckets=[1, 5, 10, 25, 50, 100, 250, 500, 1000],
)
embed_texts_per_batch = Histogram(
    "kanso_semantic_embed_texts_per_batch",
    "Number of texts per embedding batch",
    buckets=[1, 2, 4, 8, 16, 32, 64],
)
culture_requests_total = Counter(
    "kanso_semantic_culture_requests_total", "Total culture classification requests"
)
culture_latency_ms = Histogram(
    "kanso_semantic_culture_latency_ms",
    "Culture classification latency in milliseconds",
    buckets=[10, 50, 100, 250, 500, 1000, 2000],
)
