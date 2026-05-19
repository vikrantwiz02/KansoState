# Security Review

## Threat model

KansoState processes real-time audio transcripts from business meetings. The primary risk is PII leakage from the processing pipeline into logs, external services, or the analytics store.

## Controls

### PII in transit

| Surface | Control |
|---------|---------|
| Client → Sentinel | TLS (Cloud Run enforces HTTPS; WSS) |
| Sentinel → sidecar | TLS (Cloud Run service-to-service; mTLS via Google-managed certs) |
| Sentinel → Firestore | TLS (Google APIs) |
| Sentinel → GCS (redaction maps) | TLS + KMS envelope encryption |

### PII in logs

- Zap encoder has a field-level deny list: drops any field named `raw`, `text`, or `payload` unless `--debug-unsafe` is set.
- `DEBUG_UNSAFE=true` is rejected at config validation time in the `production` environment.
- CI grep (`ci-sentinel-go.yml`) scans for `debug-unsafe` in non-dev config files.
- Structured log schema test in `internal/log/log_test.go` verifies no PII field leaks.

### PII in Firestore

- Only `redacted_text` (with `[KIND_n]` placeholders) is stored in shard documents.
- The redaction map (placeholder → original) is AES-256-GCM encrypted, stored in GCS only.
- The DEK is envelope-encrypted with the KMS KEK `projects/.../cryptoKeys/redaction`.
- BigQuery contains only redacted text and placeholder hashes — no originals.

### Authentication

- Dashboard uses NextAuth Google provider; sessions are server-side.
- Sentinel read API is behind Cloud Armor + IAP in production (Cloud Run IAM `allUsers` invoker is for dev; remove before prod).
- Sidecar is only callable by Sentinel's service account (`roles/run.invoker`).

### Input validation

- WebSocket messages are JSON-decoded; malformed messages are logged (without payload) and dropped.
- Embed batch size is capped at 64 (FastAPI validator + Sentinel client enforce this).
- Vector dimension mismatch returns an error rather than silently miscomputing consensus.

### Supply chain

- Docker images are scanned by Trivy (HIGH/CRITICAL = build failure) in every CI run.
- Go module hashes are pinned in `go.sum`.
- Python model hash is pinned via `MODEL_HASH` env var and verified at startup.
- No `npm install --no-audit`; pnpm audit runs in dashboard CI.

## Known risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Unredacted PII sent to embedding sidecar | Low | High | Redaction runs before the embed request; integration tests verify no `@` / card patterns in outbound text |
| Log injection via crafted utterance text | Low | Medium | zap structured logging; no format strings from user input |
| SSRF via `EMBEDDER_URLS` | Low | Medium | Config is environment-variable-only; not runtime-settable |
| Firestore document too large | Low | Low | Shard capped at 50 events × ~2 KB = ~100 KB; Firestore max doc size is 1 MB |
| Embedding model outputs leak meeting content | Low | Medium | Embeddings are 384-dim float vectors; no reconstruction attack is practical |
| Compromised sidecar returns adversarial vectors | Low | Medium | Consensus score bounded to [-1, 1]; no code execution path from vectors |

## Outstanding items (pre-production)

- [ ] Replace `allUsers` Cloud Run invoker with IAP-protected load balancer
- [x] Add rate limiting on `/ws` per `(ip, meetingId)` using Go token bucket — implemented in `internal/server/ratelimit.go` (5 burst, 1/s refill)
- [x] Add `Content-Security-Policy` header in Next.js — implemented in `next.config.ts` `headers()` function; includes `frame-ancestors`, HSTS, `X-Content-Type-Options`, `Referrer-Policy`
- [ ] Rotate KMS keys on the 90-day schedule set in Terraform
- [ ] Complete penetration test of WebSocket endpoint before `v1.0.0`
