# KansoState

**Real-time meeting intelligence platform.** Deterministic state synchronization across concurrent speakers with sub-2-second end-to-end latency, live group video, and consensus scoring — all in the browser.

---

## What it does

KansoState turns any distributed meeting into a structured, observable event stream. Participants join via browser, speak or type, and the system continuously computes semantic alignment scores across all speakers in real time.

- **Group video calling** — WebRTC mesh with automatic camera/microphone permission guidance
- **Live speech transcription** — Web Speech API with audio level visualization
- **Consensus scoring** — cosine similarity + EMA over sentence embeddings, updated per utterance
- **Speaker timeline** — ordered, color-coded utterance history with vector-clock sequencing
- **Bridge notes** — automatic cross-cultural context tags surfaced during the meeting
- **Intent graph** — visual relationship map of speakers and semantic topics
- **PII redaction** — Aho-Corasick + regex pipeline strips names, emails, and tokens before persistence

---

## Architecture

```
Browser clients
  ├── WebRTC (mesh, /ws/signal)
  ├── WebSocket utterances (/ws)
  └── SSE subscription (/sse)
         │
         ▼
  Sentinel (Go / Gin)
  ├── Vector-clock ordering
  ├── PII redaction pipeline
  ├── Consensus engine (cosine + EMA)
  ├── Circuit breaker → sticky-vec fallback
  ├── Hot-store ring buffer (60 s)
  └── Sharded Firestore persistence
         │
         ▼
  Semantic sidecar (Python / FastAPI) ×2
  ├── POST /embed — 384-dim sentence vectors
  └── POST /classify-culture — bridge note tags
         │
         ▼
  Dashboard (Next.js 15 / App Router)
  ├── Server components + SSR hydration
  ├── Google OAuth (NextAuth v4)
  └── Real-time SSE updates
```

See [docs/architecture.md](docs/architecture.md) for full component breakdown and data-flow diagram.

---

## Tech stack

| Layer | Technology |
|---|---|
| Ingestor | Go 1.22, Gin, gorilla/websocket, sony/gobreaker |
| Consensus | Go — cosine similarity, EMA α=0.2, vector-clock ordering |
| Embeddings | Python 3.11, FastAPI, sentence-transformers (all-MiniLM-L6-v2) |
| Frontend | Next.js 15, React 18, Tailwind CSS v4, Lucide React |
| Auth | NextAuth v4, Google OAuth 2.0 |
| Video | WebRTC (browser native), signaling relay in Go |
| Speech | Web Speech API (Chrome/Edge) |
| Database | Google Firestore (emulator for dev) |
| Observability | Prometheus, Grafana |
| Infra | Docker Compose, Terraform (GCP) |

---

## Prerequisites

| Tool | Version |
|---|---|
| Docker + Docker Compose | 24+ / v2.18+ |
| Go | 1.22+ |
| Python | 3.11+ |
| Node.js | 20+ |
| pnpm | 9+ |

---

## Quick start

```sh
# 1. Clone and enter
git clone https://github.com/your-org/kansostate
cd KansoState

# 2. Copy environment template
cp .env.example .env
# Fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET, SENTINEL_API_KEY

# 3. Install dev tooling (pre-commit hook, Go deps, pnpm)
make dev-setup

# 4. Start all services
make dev-up

# 5. Seed a synthetic 3-speaker meeting
make seed
```

Services started:

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| Sentinel API | http://localhost:8080 |
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
| `NEXTAUTH_SECRET` | Yes | NextAuth signing secret (min 32 chars) |
| `NEXTAUTH_URL` | Yes | Full URL of the dashboard (e.g. `https://yourdomain.com`) |
| `SENTINEL_API_KEY` | Yes | Shared secret between dashboard and sentinel |
| `SENTINEL_WS_URL` | Yes | WebSocket URL of sentinel (e.g. `wss://api.yourdomain.com`) |
| `SENTINEL_URL` | Yes | HTTP URL of sentinel for SSR hydration |
| `EMBEDDER_URLS` | No | Comma-separated semantic sidecar URLs (default: auto from compose) |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` (default: `info`) |

---

## Running tests

```sh
make test          # all suites

# Individual:
make test-go       # go test -race -count=1 ./...
make test-py       # pytest + mypy + ruff
make test-dash     # pnpm typecheck + lint + playwright
```

---

## Production deployment

### Single-server (Docker Compose + Nginx Proxy Manager)

See [docs/runbook.md](docs/runbook.md) for the full production deployment guide including:
- Server setup and Docker installation
- Nginx Proxy Manager for multi-site routing with automatic SSL
- Environment variable configuration
- Health checks and restart policies

### Google Cloud (Terraform)

```sh
cd infra/terraform
terraform init
terraform plan -var="project_id=YOUR_PROJECT" \
               -var="sentinel_image=ghcr.io/your-org/kanso-sentinel:v0.1.0" \
               -var="semantic_image=ghcr.io/your-org/kanso-semantic:v0.1.0"
terraform apply
```

---

## SLOs

| Metric | Target |
|---|---|
| End-to-end utterance → render p95 | < 2 s |
| Redaction pipeline p95 at 200 msg/s | < 50 ms |
| Consensus update p99 | < 10 µs |
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

MIT
