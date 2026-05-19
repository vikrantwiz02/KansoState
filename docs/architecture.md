# Architecture

## Overview

```
WS clients ──▶ Sentinel (Go/Gin) ──────────────────────────────────────▶ Dashboard (Next.js 15)
                  │   ├─ sync.Pool buffers                                   ▲
                  │   ├─ worker pool (NumCPU)                                │ SSE relay
                  │   ├─ Aho-Corasick + regex PII redaction                  │ + read-API hot cache
                  │   ├─ Vector clocks (deterministic order)                 │
                  │   ├─ Consensus Engine (Go: cosine, EMA, drift)           │
                  │   ├─ Circuit breaker (sony/gobreaker)                    │
                  │   ├─ Embedding LRU cache (singleflight)                  │
                  │   ├─ Hot store (60 s ring + 50-shard LRU) ───────────────┘
                  │   └─ Sharded writes ──▶ Firestore ──CF──▶ BigQuery
                  │
                  └─HTTP─▶ Semantic sidecar (FastAPI, N replicas)
                              ├─ sentence-transformers / ONNX
                              └─ LangChain few-shot cultural classifier
```

## Component responsibilities

### Sentinel (Go/Gin)

Owns all product logic. Python is reduced to a pure ML sidecar.

| Package | Responsibility |
|---------|---------------|
| `config` | Env-based config, validation |
| `log` | zap logger with PII-safe field filter (drops `raw`, `text`, `payload`) |
| `metrics` | Prometheus counter/histogram registration |
| `redact` | Sequential PII pipeline: normalize → regex → Aho-Corasick → overlap resolution → tokenize |
| `vclock` | Logical vector clocks: `Tick`, `Merge`, `HappensBefore`, `Concurrent` |
| `pipeline` | sync.Pool buffers, NumCPU worker pool, main select loop, channel overflow metrics |
| `consensus` | Cosine similarity, EMA α=0.2, per-speaker drift, sticky-vec fallback. **All math in Go.** |
| `breaker` | sony/gobreaker around embedder client; on open → sticky-vec degradation |
| `embedcache` | hashicorp LRU + singleflight to dedupe concurrent identical embed requests |
| `hotstore` | 60-second ring buffer per meeting + subscriber fan-out. Dashboard reads here; never Firestore. |
| `wal` | Append-only JSONL per meeting; replayed on startup if Firestore was unavailable |
| `shard` | Per-meeting rolling shard writer (10 s / 50 events), FirestoreFlusher, KMS redaction map store |
| `embedder` | Round-robin HTTP client to semantic sidecar replicas |
| `server` | `/healthz`, `/metrics`, `/ws`, `/sse`, `/api/v1/meetings/:id/hydrate` |

### Semantic sidecar (Python/FastAPI)

Stateless ML service. No business logic, no circuit breaker, no state.

- `POST /embed` — batch up to 64 texts, return 384-dim vectors
- `POST /classify-culture` — few-shot cultural classifier, throttled to once per meeting per 30 s
- Adapters: `sentence_transformers` (default), `onnx` (~2× throughput), `openai_compat` (drop-in HTTP)

### Dashboard (Next.js 15 App Router)

- Server components fetch from Sentinel hot-store via `/api/v1/meetings/:id/hydrate`
- SSE relay at `/api/stream/[meetingId]` proxies Sentinel with `Last-Event-Id` resumption
- Google OAuth via NextAuth v4; middleware protects `/dashboard/*` and `/meetings/*`
- `/api/ws-ticket` and `/api/signal-ticket` — server-side routes that build WebSocket URLs (keeps API key out of client JS)

**UI components:**

| Component | Description |
|---|---|
| `ConsensusGauge` | Custom SVG arc with rainbow gradient, 5-range score labels |
| `SpeakerTimeline` | Color-coded utterance history with vector-clock sequence numbers |
| `IntentGraph` | React Flow graph of speaker–topic relationships |
| `BridgeNotes` | Tagged cross-cultural context notes, most-recent-first |
| `LiveInput` | Web Speech API transcription + manual text input + audio level visualizer |
| `VideoCall` | WebRTC mesh video call — camera/mic permission modal with OS-specific guidance |
| `SpeakerPicker` | Full-screen modal for speaker name selection, persisted to localStorage |

### WebRTC signaling (Go — `SignalHub`)

Stateless relay at `/ws/signal`. One room per meeting; peers exchange SDP offers/answers and ICE candidates through the hub.

- On join: broadcasts `room-state` (existing peer list) to newcomer; broadcasts `peer-joined` to room
- Unicasts when `msg.To` is set; broadcasts otherwise
- On disconnect: broadcasts `peer-left`, removes from room
- Enforces `msg.From = peerID` to prevent spoofing

## Concurrency model

See [data-contracts.md](data-contracts.md) for channel sizing. Key invariant: `toShard` blocks on backpressure (durability priority); all other channels drop oldest and increment `kanso_drop_total`.

## Data flow for a single utterance

```
WS message
  → pipeline.Ingest (copy to rawIn)
  → worker pool: json.Unmarshal + vclock.Tick + redact.Redact
  → fanout: toEmbedder (non-blocking) + toSSE utterance event
  → embedder batch loop: 50 ms window flush → POST /embed
  → consensus engine: Update(speaker, vec) → score, delta, drift
  → hot store: ring.Append(meetingID, ConsensusEvent SSEEnvelope)
  → SSE subscribers receive via per-meeting channel
  → shard writer: ShardEvent enqueued → rolled every 10 s or 50 events
  → Firestore → Cloud Function → BigQuery (async, non-latency-critical)
```

## Failure modes

| Failure | Behaviour |
|---------|-----------|
| Semantic sidecar down | gobreaker opens; consensus uses sticky-vec; UI shows `stale=true`; no data loss |
| Firestore latency spike | Shard writer blocks on `toShard` channel (max 4096 buffer); WAL absorbs overflow |
| Dashboard cold load | 200 ms hydrate timeout; skeleton renders; SSE hydrates incrementally |
| KMS unavailable | DEK cached per meeting; breaker degrades to "no-shard" with alert |
| WS reconnect storm | Per-(ip,meetingId) token bucket; SSE `Last-Event-Id` resumption from ring buffer |
