# Service Level Objectives

## Latency SLOs

| Metric | Target | Alert threshold |
|--------|--------|----------------|
| End-to-end utterance → dashboard render p95 | < 2 s | > 2 s for 2 min |
| End-to-end p99 | < 3.5 s | — |
| Redaction pipeline p95 | < 50 ms at 200 msg/s | > 50 ms for 2 min |
| Consensus update p99 | < 10 µs | — (in-process, no alert) |
| Hot-store hydrate p95 | < 50 ms | — |
| SSE subscriber lag | < 1.5 s steady-state | — |

## Throughput SLO

- 100 concurrent speakers × 4 utterances/s × 5 min continuous load
- 0 drops on `toShard` channel in steady state
- Embedding queue depth < 500 in steady state

## Availability

- Sentinel: 99.9% uptime
- Semantic sidecar: best-effort; circuit breaker degrades to sticky-vec (no data loss)
- Dashboard: 99.5% uptime (SSR skeleton renders within 200 ms even if sentinel slow)

## Prometheus Queries (verification)

```promql
# p95 e2e latency (must be < 2000 ms)
histogram_quantile(0.95, sum by (le)(rate(kanso_e2e_latency_ms_bucket[1m])))

# p99 redaction latency (must be < 50000 µs = 50 ms)
histogram_quantile(0.99, sum by (le)(rate(kanso_redact_latency_us_bucket[1m])))

# zero drops in steady state
rate(kanso_drop_total[1m]) == 0

# avg GC pause ≤ 1 ms
rate(go_gc_pause_ns_sum[1m]) / rate(go_gc_pause_ns_count[1m]) < 1e6
```
