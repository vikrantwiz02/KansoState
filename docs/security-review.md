# Security Review

## Threat model

KansoState processes real-time audio transcripts from business meetings. Primary risks:
1. PII leakage from the processing pipeline into logs, external services, or analytics
2. Unauthorized meeting access
3. WebSocket/WebRTC spoofing or injection
4. Supply-chain compromise

---

## Network boundary

| Path | Protection |
|---|---|
| Browser → Cloudflare | TLS (Cloudflare terminates) |
| Cloudflare → Tailscale Funnel | TLS (Tailscale edge terminates; Tailscale-managed cert) |
| Tailscale Funnel → Apache | localhost only (no external exposure) |
| Apache → Docker containers | 127.0.0.1 bindings only (`127.0.0.1:3010:3000` etc.) |
| Dashboard → Sentinel (internal) | Docker bridge network; `http://sentinel:8080` not reachable from outside |
| Sentinel → Semantic sidecar | Docker bridge network; internal only |

No Docker port is exposed to the public internet (`0.0.0.0` binding). All external traffic must pass through Tailscale Funnel → Apache.

---

## Authentication

### Dashboard

- Google OAuth 2.0 via NextAuth v4; sessions are HTTP-only server-side cookies
- All `/dashboard/*` and `/meetings/*` routes protected by middleware; unauthenticated requests redirected to `/auth/signin`
- Authorized redirect URI must exactly match `https://kansostate.vikrantkumar.site/api/auth/callback/google`

### Sentinel API key

- `SENTINEL_API_KEY` gates all Sentinel endpoints with `Authorization: Bearer`, `X-Sentinel-Key` header, or `?token=` query param
- When empty (current production default), auth middleware is a no-op — acceptable because Sentinel is only reachable via the Tailscale network boundary
- If set, the same key must be configured in both dashboard and sentinel environments

### WebRTC signaling

- `msg.From` is overwritten by the server to the peer's authenticated `peerId` from the URL — prevents identity spoofing in relayed offers/answers
- `peerId` comes from the user's session (NextAuth `session.user.name`) via `/api/signal-ticket`

---

## PII in transit

| Surface | Control |
|---|---|
| Client → Sentinel (WS) | WSS; TLS terminated at Tailscale edge |
| Sentinel → sidecar (HTTP) | Docker internal network; no TLS needed |
| Sentinel → Firestore | TLS via Google APIs |

---

## PII in logs

- zap encoder has a field-level deny-list: drops any field named `raw`, `text`, or `payload` unless `--debug-unsafe` is set
- `DEBUG_UNSAFE=true` is rejected at config validation time in the `production` environment
- CI grep scans for `debug-unsafe` in non-dev config files
- Structured log test verifies no PII field leaks

---

## PII in persistence

- Only `redacted_text` (with `[KIND_n]` placeholders) is stored in Firestore shard documents
- The redaction map (placeholder → original) is AES-256-GCM encrypted, stored separately in GCS
- The DEK is envelope-encrypted with a KMS KEK
- BigQuery contains only redacted text and placeholder hashes — no originals

---

## Input validation

| Surface | Validation |
|---|---|
| WebSocket messages | JSON-decoded; malformed messages logged (without payload) and dropped |
| `meetingId` / `peerId` | Max 128 chars enforced at Sentinel and signal-ticket route |
| Embed batch | Capped at 64 texts (FastAPI validator + Sentinel client) |
| Vector dimension | Mismatch returns error; never silently miscomputes consensus |
| WebSocket read limit | 64 KB per message (`conn.SetReadLimit`) |

---

## WebRTC security

- ICE candidates: queued until `setRemoteDescription` completes; no candidate is added to a broken PC state
- Screen share: `replaceTrack` is atomic across all peer connections; rollback on partial failure prevents track leakage to unintended peers
- `onended` handler on screen tracks: automatic camera restoration when browser stop-share UI is used; no orphaned screen tracks

---

## Supply chain

- Docker images scanned by Trivy (HIGH/CRITICAL → build failure) in every CI run
- Go module hashes pinned in `go.sum`
- Python model hash pinned via `MODEL_HASH` env var, verified at sidecar startup
- pnpm audit runs in dashboard CI; `--no-audit` is not used

---

## Outstanding items

| Item | Risk | Mitigation |
|---|---|---|
| No TURN server for WebRTC | P2P fails for symmetric NAT; users on restrictive networks cannot connect | STUN works for most home/office networks; TURN can be added via coturn |
| `SENTINEL_API_KEY` empty in production | Sentinel accepts all requests if Tailscale boundary is breached | Acceptable given Tailscale isolation; set key if threat model changes |
| Google OAuth allowed users | Any Google account can sign in | Add `GOOGLE_ALLOWED_EMAILS` allowlist in NextAuth config if needed |
| No rate limiting on WebSocket messages | A malicious authenticated user could flood the pipeline | Per-(ip, meetingId) token bucket exists on reconnect storm; per-message rate limit not yet implemented |
