# Architecture

## Overview

```
Browser (Chrome / Edge)
  ├── WebRTC video/audio mesh  ── wss://fusion-virtual-machine.taila689d6.ts.net/ws/signal
  ├── WebSocket utterances  ───── wss://fusion-virtual-machine.taila689d6.ts.net/ws
  └── SSE subscription  ────────── /api/stream/[meetingId]  (Next.js server-side relay)

Public routing (HTTPS / WSS)
  Browser
    → Cloudflare DNS (proxy)
    → Cloudflare Worker  (adds X-Kanso-Target header, routes by hostname)
    → Tailscale Funnel  (TLS-terminated at Tailscale edge)
    → Apache2 :80  (routes by X-Kanso-Target header)
      ├── kansostate.vikrantkumar.site    → 127.0.0.1:3010 (Dashboard)
      ├── api.kansostate.vikrantkumar.site → 127.0.0.1:8180 (Sentinel) [HTTP]
      └── grafana.kansostate.vikrantkumar.site → 127.0.0.1:3011 (Grafana)

WebSocket routing (WSS — bypasses Worker, direct Tailscale FQDN)
  Browser
    → wss://fusion-virtual-machine.taila689d6.ts.net/ws[/signal]
    → Tailscale Funnel  (SNI accepted — Tailscale cert covers *.taila689d6.ts.net)
    → Apache2 :80  (path-based: /ws* → 127.0.0.1:8180)
    → Sentinel :8180

Container-to-container (Docker internal network)
  Dashboard → http://sentinel:8080      (SSR hydration, SSE relay)
  Sentinel  → http://semantic-1:8090,http://semantic-2:8090  (embeddings)
  All       → firestore:8081            (Firestore emulator — dev only)

Sentinel (Go / Gin)
  ├── sync.Pool buffers
  ├── worker pool (NumCPU goroutines)
  ├── Aho-Corasick + regex PII redaction
  ├── Vector clocks (deterministic causal ordering)
  ├── Consensus Engine (cosine, EMA α=0.2, per-speaker drift)
  ├── Circuit breaker (sony/gobreaker) → sticky-vec degradation
  ├── Embedding LRU cache (singleflight dedup)
  ├── Hot store (60 s ring + 50-shard LRU) ──────▶ SSE fan-out
  └── Sharded writes ──▶ Firestore ──CF──▶ BigQuery

Semantic sidecar (FastAPI ×2 replicas)
  ├── POST /embed           — batch → 384-dim sentence vectors
  └── POST /classify-culture — few-shot cultural context classifier
```

---

## Component responsibilities

### Sentinel (Go / Gin)

Owns all product logic. Python is a stateless ML sidecar with zero business logic.

| Package | Responsibility |
|---|---|
| `config` | Env-based config with validation |
| `log` | zap logger; PII-safe field deny-list drops `raw`, `text`, `payload` |
| `metrics` | Prometheus counter/histogram registration |
| `redact` | Sequential PII pipeline: normalize → regex → Aho-Corasick → overlap resolution |
| `vclock` | Logical vector clocks: `Tick`, `Merge`, `HappensBefore`, `Concurrent` |
| `pipeline` | sync.Pool buffers, NumCPU worker pool, main select loop, channel overflow metrics |
| `consensus` | Cosine similarity, EMA α=0.2, per-speaker drift, sticky-vec fallback — all math in Go |
| `breaker` | sony/gobreaker around embedder client; on open → sticky-vec degradation |
| `embedcache` | hashicorp/LRU + singleflight to dedupe concurrent identical embed requests |
| `hotstore` | 60-second ring buffer per meeting + subscriber fan-out; dashboard reads here, never Firestore |
| `wal` | Append-only JSONL per meeting; replayed on startup if Firestore was unavailable |
| `shard` | Per-meeting rolling shard writer (10 s / 50 events), FirestoreFlusher |
| `embedder` | Round-robin HTTP client across semantic sidecar replicas |
| `server` | `/healthz`, `/metrics`, `/ws`, `/ws/signal`, `/sse`, `/api/v1/meetings/:id/hydrate` |

### SignalHub (Go — WebRTC signaling)

Stateless relay at `/ws/signal`. One room per meeting; room destroyed when last peer leaves.

- **Join**: broadcasts `room-state` (existing peer list) to newcomer; broadcasts `peer-joined` to room
- **Unicast**: routes `offer`, `answer`, `ice` by `msg.To` field
- **Leave**: broadcasts `peer-left`, removes from room, cleans up room if empty (no memory leak)
- **Spoofing protection**: enforces `msg.From = peerId` from URL, not from the message body
- **Backpressure**: 512-slot buffered channels per peer; `trySend` checks a `closed` channel guard before every write (prevents "send on closed channel" panic)
- **Write pump**: drains remaining messages before exiting on write error; no goroutine leak

### WebRTC client (VideoCall)

- **HD camera**: `1920×1080` ideal / `1280×720` min, 30 fps, `facingMode: user`
- **Audio**: `echoCancellation`, `noiseSuppression`, `sampleRate: 48000`
- **ICE candidate queuing**: candidates arriving before `setRemoteDescription` queued in `iceCandidateQueueRef`; drained immediately after remote description is set — prevents race condition that silently drops ICE candidates
- **`onnegotiationneeded` guard**: `signalingState !== "stable"` prevents duplicate offers mid-negotiation
- **Screen share**: atomic `Promise.all(replaceTrack)` before local state changes; full rollback on partial failure; camera auto-restored when browser stop-share UI fires (`screenTrack.onended`)
- **View switching**: callback ref (`attachLocalStream`) re-attaches `srcObject` on every mount, so grid ↔ speaker view never loses the local camera feed
- **Concurrent join guard**: `joiningRef` prevents overlapping `joinCall` executions
- **Timeout**: 10-second WebSocket connection timeout; error displayed in join UI

### LiveInput (transcription)

- **Auto-transcription**: starts automatically when video call is joined (`autoListen` prop); the video join click is the required browser user gesture — no separate "Start listening" click needed
- **AudioContext lifecycle**: stored in `audioCtxRef`, closed on mic stop and unmount — no OS-level audio leak
- **SpeechRecognition restart loop**: `intentionalStop` ref distinguishes deliberate stop from browser `onend` — prevents infinite restart loop
- **Ref-based state**: `toggleMic` checks `recognitionRef.current` (always current) rather than `listening` state (stale in closures)
- **Auto-stop on call end**: when `autoListen` becomes false, recognition stops via `recognitionRef.current` (not stale state)
- **Retry on mic failure**: if auto-start fails (denied permission), `autoStartedRef` resets so future WebSocket reconnects retry

### Dashboard (Next.js 15 App Router)

- Server components fetch from Sentinel hot-store via `/api/v1/meetings/:id/hydrate`
- SSE relay at `/api/stream/[meetingId]` proxies Sentinel with `Last-Event-Id` resumption
- Google OAuth via NextAuth v4; middleware protects `/dashboard/*` and `/meetings/*`
- `/api/ws-ticket` and `/api/signal-ticket` build WebSocket URLs server-side (API key never in client bundle)
- WebSocket URL uses Tailscale FQDN directly — bypasses Cloudflare Worker, which cannot reliably proxy WebSocket Ping/Pong keepalives at the application layer

---

## Concurrency model

| Channel | Direction | Size | Drop policy |
|---|---|---|---|
| `rawIn` | WS handler → pipeline | 4096 | Drop oldest; increment `kanso_drop_total` |
| `toEmbedder` | pipeline → embedder loop | 1024 | Non-blocking; drop if full |
| `toSSE` | pipeline → SSE bridge | 1024 | Non-blocking |
| `toShard` | consensus → shard writer | 4096 | **Blocks** (durability priority) |
| `peer.send` (signal) | SignalHub → write pump | 512 | Drop if full; no panic via `closed` guard |

Key invariant: `toShard` blocks on backpressure — durability over throughput.

---

## Single-utterance data flow

```
1. User speaks → Web Speech API → text_chunk WebSocket message
2. Sentinel /ws handler: json.Unmarshal + vclock.Tick + redact.Redact
3. Fanout:
   a. toSSE → utterance event → SSE subscribers (~5 ms)
   b. toEmbedder → 50 ms batch window flush
4. POST /embed (sentence-transformers) → 384-dim vector
5. consensus.Update(speakerID, vec) → score, delta, drift
6. hot.Append(meetingID, ConsensusEvent envelope)
7. SSE subscribers receive consensus update (total ~50–500 ms)
8. toShard → ShardEvent → flush every 10 s or 50 events
9. Firestore (async) → Cloud Function → BigQuery
```

---

## Failure modes

| Failure | Behaviour |
|---|---|
| Semantic sidecar down | gobreaker opens after 5 failures; consensus uses sticky-vec; UI shows `stale=true`; zero data loss |
| Firestore latency spike | `toShard` buffer (4096) absorbs bursts; WAL absorbs overflow; replayed on restart |
| Dashboard cold load | 200 ms hydrate timeout; skeleton renders; SSE hydrates incrementally |
| WS reconnect storm | Per-(ip, meetingId) token bucket; SSE `Last-Event-Id` from ring buffer resumes from last event |
| Screen share stopped by browser UI | `screenTrack.onended` auto re-acquires camera and replaces track in all peer connections |
| WebSocket connect timeout | 10-second timeout; error shown in join UI; camera/mic tracks stopped |
| Peer connection failed | `failed`/`closed` state removes PC from `pcsRef`, drains ICE queue; peer rejoins cleanly |
| Signal channel full | `trySend` drops message silently; no goroutine block, no panic; signaling retried by ICE trickle |

---

## Production infrastructure

| Component | Technology | Role |
|---|---|---|
| Cloudflare | DNS proxy + Worker | Domain routing, DDoS protection, HTTP-level `X-Kanso-Target` header injection |
| Tailscale Funnel | HTTPS proxy | Zero-firewall public HTTPS, Tailscale-managed TLS certs |
| Apache2 | VirtualHost + mod_proxy_wstunnel | Multi-domain routing by `X-Kanso-Target`; WebSocket upgrade proxying |
| Docker Compose | Container orchestration | All services on one VM, healthchecked |
| Prometheus + Grafana | Observability | Metrics, dashboards, alerting |
