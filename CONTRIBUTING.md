# Contributing to KansoState

## Getting started

```sh
git clone https://github.com/your-org/kansostate
cd KansoState
make dev-setup   # installs pre-commit hook, runs go mod tidy, pnpm install
make dev-up      # starts full stack via docker compose
```

---

## Attribution policy

No file, commit message, comment, log line, README sentence, package metadata, or UI string may reference specific tooling used during development, generation methods, or carry assistant-related commit trailers.

The full denylist is in `.attribution-denylist`. `scripts/check-attribution.sh` scans every CI diff against it — violations fail the build immediately. The pre-commit hook strips forbidden trailers automatically before commit.

---

## Branch conventions

| Branch | Purpose |
|---|---|
| `main` | Always green, deployable |
| `feat/<slug>` | New features |
| `fix/<slug>` | Bug fixes |
| `chore/<slug>` | Maintenance, dependency updates |
| `perf/<slug>` | Performance improvements |
| `docs/<slug>` | Documentation only |

---

## Commit style

```
<type>(<scope>): <short imperative summary>

[optional body — explain WHY, not WHAT]
```

**Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`

**Scopes:** `sentinel`, `semantic`, `dashboard`, `infra`, `ci`

Examples:
```
feat(dashboard): add fullscreen toggle and speaker/pin view to video call
fix(sentinel): queue ICE candidates until setRemoteDescription completes
perf(consensus): replace reflect.DeepEqual with manual cosine check
```

Keep the subject line under 72 characters. No trailing period.

---

## Test requirements

All three suites must pass before merge.

### Go (Sentinel)
```sh
cd services/sentinel-go
go test -race -count=1 ./...
golangci-lint run ./...
```

### Python (Semantic sidecar)
```sh
cd services/semantic-py
pytest
mypy --strict .
ruff check .
ruff format --check .
```

### Dashboard
```sh
cd apps/dashboard
pnpm typecheck
pnpm lint
pnpm playwright test   # requires dev stack running
```

---

## Code style

### Go
- Format: `gofmt` (enforced by `golangci-lint`)
- No `interface{}` — use typed generics or concrete types
- Error wrapping: `fmt.Errorf("context: %w", err)`, never swallowed silently
- Channels: always handle the `closed` guard before send; use `select` with `default` for non-blocking

### Python
- Format: `ruff format`
- Lint: `ruff check` + `mypy --strict`
- No bare `except:` — always catch specific exception types

### TypeScript
- Format + lint: `pnpm lint` (ESLint + Prettier)
- No `any` without `// eslint-disable-next-line` explaining why
- Server components by default; `"use client"` only when browser APIs are required
- Use `useRef` for mutable values that don't drive render; avoid stale closures capturing state

### WebRTC / WebSocket patterns
- Set `onclose` and `onerror` handlers before awaiting `onopen`
- Use `joiningRef` guard on async actions triggered by user click
- ICE candidates: queue until `remoteDescription` is set; never add speculatively
- Screen share: `replaceTrack` atomically via `Promise.all` before modifying local stream state
- `onnegotiationneeded`: guard with `signalingState !== "stable"` to prevent duplicate offers

---

## Pull request checklist

- [ ] All three test suites pass locally
- [ ] No new `// TODO` or `// FIXME` without an issue reference
- [ ] `docs/` updated if public API or data contracts changed
- [ ] `scripts/check-attribution.sh` passes on the PR diff
- [ ] No secrets, credentials, or `.env` files committed
- [ ] WebRTC changes tested with two browser tabs on separate networks if possible

---

## Running the load test

Requires [k6](https://k6.io/docs/get-started/installation/) and the full dev stack running.

```sh
SENTINEL_WS=ws://localhost:8080/ws \
MEETING_ID=loadtest-$(date +%s) \
k6 run tests/load/k6/100-speakers.js
```

Pass criteria: p95 e2e < 2000 ms, p99 < 3500 ms, `ws_errors` < 10, `toShard` drops = 0.

---

## Cutting a release

```sh
git tag v0.2.0
git push origin v0.2.0
# CI release.yml: attribution check → docker build → push → GitHub release
```

See [docs/release-v0.1.0.md](docs/release-v0.1.0.md) for the pre-release gate checklist.

---

## License

By contributing you agree that your contributions will be licensed under the [MIT License](./LICENSE).
