package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	E2ELatencyMs = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "kanso_e2e_latency_ms",
		Help:    "End-to-end utterance to SSE emit latency in milliseconds.",
		Buckets: prometheus.ExponentialBuckets(10, 2, 12),
	})

	RedactLatencyUs = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "kanso_redact_latency_us",
		Help:    "Redaction pipeline latency in microseconds.",
		Buckets: prometheus.ExponentialBuckets(100, 2, 12),
	})

	ConsensusUpdateNs = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "kanso_consensus_update_ns",
		Help:    "Consensus engine Update() call latency in nanoseconds.",
		Buckets: prometheus.ExponentialBuckets(100, 2, 14),
	})

	EmbedLatencyMs = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "kanso_embed_latency_ms",
		Help:    "Embedding RPC latency in milliseconds.",
		Buckets: prometheus.ExponentialBuckets(1, 2, 12),
	})

	DropTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "kanso_drop_total",
		Help: "Total messages dropped by stage.",
	}, []string{"stage"})

	BreakerStateChanges = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "kanso_breaker_state_changes_total",
		Help: "Circuit breaker state transitions.",
	}, []string{"from", "to"})

	BreakerOpen = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "kanso_breaker_open",
		Help: "1 if the embedder circuit breaker is open, 0 otherwise.",
	})

	StickyVecFallbackTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "kanso_sticky_vec_fallback_total",
		Help: "Total consensus updates that used a cached sticky vector due to open breaker.",
	})

	EmbedQueueDepth = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "kanso_embed_queue_depth",
		Help: "Number of texts pending embedding.",
	})

	EmbedCacheHits = promauto.NewCounter(prometheus.CounterOpts{
		Name: "kanso_embed_cache_hits_total",
		Help: "Total embedding LRU cache hits.",
	})

	EmbedCacheMisses = promauto.NewCounter(prometheus.CounterOpts{
		Name: "kanso_embed_cache_misses_total",
		Help: "Total embedding LRU cache misses.",
	})

	ShardWriteTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "kanso_shard_write_total",
		Help: "Total shard write operations.",
	}, []string{"meeting_id"})

	ShardRollTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "kanso_shard_roll_total",
		Help: "Total shard rolls.",
	})

	WALWriteTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "kanso_wal_write_total",
		Help: "Total WAL write operations.",
	})

	WALReplayTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "kanso_wal_replay_total",
		Help: "Total WAL replay operations.",
	})

	ActiveConnections = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "kanso_active_ws_connections",
		Help: "Number of active WebSocket connections.",
	})

	SSESubscribers = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "kanso_sse_subscribers",
		Help: "Number of active SSE subscribers.",
	})

	ConsensusStaleTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "kanso_consensus_stale_total",
		Help: "Total consensus events emitted with stale=true flag.",
	})
)
