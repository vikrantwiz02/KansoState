# KansoState

**Real-time meeting intelligence platform.** Participants speak, and the system continuously scores semantic alignment across all speakers — surfacing convergence, divergence, and context notes before the meeting ends. Paired with native HD group video, auto-transcription, screen share, and a live intent graph.

Live at **[kansostate.vikrantkumar.site](https://kansostate.vikrantkumar.site)**

---

## What makes it different from anything in the market

| Capability | KansoState | Zoom / Meet / Teams | Fireflies / Otter.ai | Miro / Notion AI |
|---|---|---|---|---|
| Real-time semantic consensus score | **Yes** | No | No | No |
| Per-speaker semantic drift detection | **Yes** | No | No | No |
| Auto-generated bridge notes mid-meeting | **Yes** | No | No | No |
| Vector-clock causal utterance ordering | **Yes** | No | No | No |
| PII-redacted embeddings (reversible) | **Yes** | No | Partial | No |
| Circuit-breaker degradation (no data loss) | **Yes** | N/A | No | No |
| Native WebRTC + intelligence in one product | **Yes** | Video only | Transcript only | No video |
| Intent graph (live topic cluster map) | **Yes** | No | No | No |
| Transcription auto-starts on video join | **Yes** | No | Plugin only | No |
| 60-second hot-store (no Firestore reads on SSE) | **Yes** | N/A | N/A | N/A |

### The core insight no other product captures

Every meeting has a **consensus curve** — speakers start apart (forming), converge as they negotiate, then either align (consensus) or fragment (divergence). No existing tool measures this curve in real time. KansoState does, at the utterance level, and surfaces actionable bridge notes automatically ("alignment dropping — consider an explicit check-in", "strong alignment — good moment to record decisions").

---

## Features

### Meeting intelligence
- **Consensus gauge** — cosine similarity + EMA over 384-dim sentence embeddings, updated per utterance, visualised as a −1 → +1 arc
- **Semantic drift** — per-speaker drift from their own historical centroid; surfaces "speaker-drift" bridge notes when a speaker shifts topic significantly
- **Bridge notes** — rule-based AI context tags generated every 5 utterances: `converging`, `diverging`, `high-alignment`, `early-stage`, `speaker-drift`
- **Speaker timeline** — vector-clock ordered utterance history, color-coded per speaker
- **Intent graph** — live React Flow semantic topic cluster map

### Video call
- **HD group video** — WebRTC mesh, `1080p` ideal / `720p` min, 30 fps
- **Noise cancellation + echo suppression** — browser-native `AudioContext` constraints
- **Screen share** — atomic `replaceTrack` across all peer connections with camera rollback on failure
- **Speaker / pin view** — click any tile to pin; sidebar shows other participants
- **Grid view** — responsive 1 / 2 / 3-column layout up to any number of peers
- **Fullscreen** — standard Fullscreen API, ESC to exit
- **Auto-transcription on join** — speech recognition starts automatically when you join the video call; no separate click needed

### Infrastructure
- **Sub-2-second end-to-end latency** utterance → consensus render (p95)
- **PII redaction** — Aho-Corasick + regex pipeline, only redacted text reaches embeddings and Firestore
- **Circuit breaker** — embedding sidecar down → sticky-vec consensus, `stale` flag in UI, zero data loss
- **WAL** — write-ahead log for Firestore unavailability; replays on startup
- **ICE candidate queuing** — candidates arriving before `setRemoteDescription` are queued and drained; reliable WebRTC even on high-latency paths

---

## Architecture

```
Browser (Chrome / Edge)
  ├── WebRTC mesh video  ──────── wss://[tailscale-fqdn]/ws/signal
  ├── WebSocket utterances ─────── wss://[tailscale-fqdn]/ws
  └── SSE subscription ─────────── /api/stream/[meetingId]  (server-side relay)
         │
         ▼
  Next.js 15 (Dashboard)
  ├── Google OAuth (NextAuth v4)
  ├── /api/ws-ticket   — builds wss:// URL (API key never in client JS)
  ├── /api/signal-ticket — builds signal wss:// URL
  └── /api/stream/[id] — SSE proxy with Last-Event-Id resumption
         │ http://sentinel:8080 (container-to-container)
         ▼
  Sentinel (Go / Gin)
  ├── /ws           — WebSocket utterance ingestor
  ├── /ws/signal    — WebRTC signaling hub (SignalHub)
  ├── /sse          — SSE fan-out from hot-store ring buffer
  ├── /healthz      — health probe
  ├── /metrics      — Prometheus
  └── Pipeline:
      sync.Pool → worker pool (NumCPU) → PII redact → vclock.Tick
      → toSSE utterance event → toEmbedder batch (50 ms flush)
      → POST /embed → consensus.Update → hot-store ring.Append
      → SSE subscribers → toShard → Firestore
         │
         ▼
  Semantic sidecar (Python / FastAPI) ×2
  ├── POST /embed        — batch up to 64 texts → 384-dim vectors
  └── POST /classify-culture — few-shot cultural context classifier

Production routing:
  Browser → Cloudflare (DNS proxy) → Cloudflare Worker
    → Tailscale Funnel (HTTPS, SNI-terminated)
      → Apache2 (host routing by X-Kanso-Target header)
        → Dashboard :3010 | Sentinel :8180 | Grafana :3011
```

See [docs/architecture.md](docs/architecture.md) for the full component breakdown.

---

## Tech stack

| Layer | Technology |
|---|---|
| Ingestor / Signaling | Go 1.22, Gin, gorilla/websocket, sony/gobreaker |
| Consensus | Go — cosine similarity, EMA α=0.2, per-speaker drift, vector clocks |
| Embeddings | Python 3.11, FastAPI, sentence-transformers (all-MiniLM-L6-v2 / ONNX) |
| Frontend | Next.js 15 App Router, React 18, Tailwind CSS v4, Lucide React |
| Video | WebRTC (browser-native mesh), signaling relay in Go |
| Speech | Web Speech API (Chrome / Edge), auto-starts on video call join |
| Auth | NextAuth v4, Google OAuth 2.0 |
| Database | Google Firestore (emulator for dev) |
| Observability | Prometheus, Grafana |
| Infra (prod) | Docker Compose, Apache2, Tailscale Funnel, Cloudflare Worker |
| Infra (cloud) | Terraform (GCP — Cloud Run, Firestore, KMS, BigQuery) |

---

## Quick start (local dev)

```sh
# 1. Clone
git clone https://github.com/your-org/kansostate
cd KansoState

# 2. Copy env template and fill in credentials
cp .env.example .env
# Required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET, SENTINEL_API_KEY

# 3. Install dev tooling
make dev-setup   # pre-commit hook, go mod tidy, pnpm install

# 4. Start all services
make dev-up

# 5. Seed a synthetic 3-speaker meeting
make seed
```

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| Sentinel | http://localhost:8080 |
| Semantic sidecar | http://localhost:8090 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (admin / admin) |
| Firestore emulator | localhost:8081 |

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `NEXTAUTH_SECRET` | Yes | NextAuth signing secret (≥ 32 chars) |
| `NEXTAUTH_URL` | Yes | Full URL of the dashboard |
| `SENTINEL_API_KEY` | Yes | Shared secret between dashboard and sentinel |
| `SENTINEL_WS_URL` | Yes | Public WebSocket URL for browsers (`wss://...`) |
| `SENTINEL_URL` | Yes | Internal HTTP URL for SSR hydration (`http://sentinel:8080`) |
| `SENTINEL_PUBLIC_URL` | No | Public HTTPS URL for browser API calls |
| `EMBEDDER_URLS` | No | Comma-separated sidecar URLs (default: from compose) |
| `LOG_LEVEL` | No | `debug` / `info` / `warn` / `error` (default: `info`) |

---

## Running tests

```sh
make test          # all suites

make test-go       # go test -race -count=1 ./...
make test-py       # pytest + mypy + ruff
make test-dash     # pnpm typecheck + lint + playwright
```

---

## Production deployment

### Single-server (Docker Compose + Tailscale + Cloudflare)

See [docs/runbook.md](docs/runbook.md) for the full guide covering:
- Tailscale Funnel for public HTTPS without open firewall ports
- Cloudflare Worker for multi-domain routing
- Apache2 vhost setup with `X-Kanso-Target` header routing
- Environment setup and container lifecycle

### Google Cloud (Terraform)

```sh
cd infra/terraform
terraform init
terraform plan -var="project_id=YOUR_PROJECT" \
               -var="sentinel_image=ghcr.io/your-org/kanso-sentinel:v0.2.0" \
               -var="semantic_image=ghcr.io/your-org/kanso-semantic:v0.2.0"
terraform apply
```

---

## SLOs

| Metric | Target |
|---|---|
| End-to-end utterance → consensus render p95 | < 2 s |
| Redaction pipeline p95 at 200 msg/s | < 50 ms |
| Consensus update p99 (in-process) | < 10 µs |
| Sentinel uptime | 99.9% |

See [docs/slo.md](docs/slo.md) and [docs/perf-baselines.md](docs/perf-baselines.md).

---

## Documentation

| Document | Description |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Component design, data flow, failure modes |
| [docs/data-contracts.md](docs/data-contracts.md) | WebSocket, SSE, REST, and Firestore schemas |
| [docs/runbook.md](docs/runbook.md) | Local dev, production deployment, alert response |
| [docs/slo.md](docs/slo.md) | Service level objectives and Prometheus queries |
| [docs/perf-baselines.md](docs/perf-baselines.md) | Benchmark baselines and CI gates |
| [docs/security-review.md](docs/security-review.md) | Security posture and outstanding items |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branch conventions, commit style, test requirements |

---

## License

[MIT](./LICENSE) © 2026 Vikrant Kumar
