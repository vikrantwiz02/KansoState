# Performance Baselines

Baselines measured on a 4-core / 16 GB dev machine. CI nightly checks gate on these values.

## Consensus engine (`BenchmarkConsensus_Update`)

| Metric | Baseline | Gate (fail if worse) |
|--------|----------|----------------------|
| ns/op  | ~150     | 200                  |
| allocs | 0        | 0                    |

A 384-dim cosine similarity update must complete in ≤ 200 ns (= 5 M ops/s on a single core).

## Redaction pipeline (`BenchmarkRedact_200msg`)

| Metric | Baseline | Gate |
|--------|----------|------|
| p95 µs | ~800     | 5000 |

Measured at 200 concurrent messages/s through the full pipeline: normalize → regex → Aho-Corasick → overlap → tokenize.

## Buffer pool (`BenchmarkBufferPool`)

| Metric | Baseline | Gate |
|--------|----------|------|
| allocs | 0 after warmup | 1 (Get + Put pair must be alloc-free) |

## Embedding cache (`BenchmarkEmbedCache_GetOrFetch`)

| Metric | Baseline | Gate |
|--------|----------|------|
| Hit ns/op  | ~80   | 200  |
| Miss ns/op | ~200  | 500  |

## End-to-end (k6 load test, 100 speakers × 4 utt/s × 5 min)

| Metric | Target | Fail threshold |
|--------|--------|---------------|
| p95 e2e latency | < 2000 ms | 2000 ms |
| p99 e2e latency | < 3500 ms | 3500 ms |
| WS errors | 0 | 10 |
| toShard drops | 0 | 0 |
