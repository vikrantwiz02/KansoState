# Runbook

## Local development

### First-time setup

```sh
git clone https://github.com/your-org/kansostate
cd KansoState
cp .env.example .env          # fill in credentials
make dev-setup                # go mod tidy, pre-commit hook, pnpm install
make dev-up                   # docker compose up + health poll
make seed                     # seed a 3-speaker synthetic meeting
```

Services:

| Service | URL | Notes |
|---|---|---|
| Dashboard | http://localhost:3000 | Google OAuth required |
| Sentinel | http://localhost:8080 | WebSocket + SSE + REST |
| Semantic sidecar | http://localhost:8090 | Embedding + classification |
| Prometheus | http://localhost:9090 | Metrics |
| Grafana | http://localhost:3001 | admin / admin |
| Firestore emulator | localhost:8081 | Local persistence |

### Common dev commands

```sh
make dev-up       # start all services
make dev-down     # stop all services
make dev-logs     # tail all service logs
make seed         # seed synthetic meeting data
make test         # run all test suites
make lint         # lint all services
```

---

## Production deployment — Docker Compose (single server)

### Server requirements

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB | 40 GB |
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04+ LTS |

### 1. Install Docker

```sh
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
sudo systemctl enable docker
```

### 2. Create shared Docker network

```sh
docker network create proxy
```

### 3. Set up Nginx Proxy Manager

Nginx Proxy Manager handles SSL termination and domain routing for all hosted sites.

```sh
mkdir -p ~/nginx-proxy-manager && cd ~/nginx-proxy-manager
cat > docker-compose.yml << 'EOF'
services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "81:81"
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
    networks:
      - proxy

networks:
  proxy:
    external: true
EOF
docker compose up -d
```

Access the NPM admin UI at `http://SERVER_IP:81`.
Default credentials: `admin@example.com` / `changeme` — **change immediately**.

### 4. Deploy KansoState

```sh
mkdir -p ~/sites/kansostate && cd ~/sites/kansostate
git clone https://github.com/your-org/kansostate .
cp .env.example .env
```

Edit `.env` with production values:

```sh
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
NEXTAUTH_SECRET=your-32-char-minimum-secret
NEXTAUTH_URL=https://yourdomain.com
SENTINEL_API_KEY=your-api-key
SENTINEL_WS_URL=wss://api.yourdomain.com
```

Use the production compose override:

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### 5. Configure domains in Nginx Proxy Manager

For each domain:
1. **NPM UI → Proxy Hosts → Add Proxy Host**
2. Domain: `yourdomain.com` → Forward to `dashboard:3000`
3. Domain: `api.yourdomain.com` → Forward to `sentinel:8080` → enable **Websockets Support**
4. SSL tab → Request Let's Encrypt certificate → Force SSL

### 6. Update Google OAuth

In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), add to **Authorized redirect URIs**:
```
https://yourdomain.com/api/auth/callback/google
```

---

## Alert response

### `E2ELatencyHigh` — p95 > 2 s

1. Check `kanso_embed_queue_depth` — if > 200, scale semantic replicas.
2. Check `kanso_breaker_open` — if 1, embedder is down (see **BreakerOpen** below).
3. Check `kanso_redact_latency_us` p99 — if > 10 ms, inspect Aho-Corasick dictionary size.
4. Check GC pause (`go_gc_pause_ns`): if avg > 1 ms, look for allocation hot paths in redact or hotstore.

### `BreakerOpen` — embedder circuit open

- Sentinel automatically falls back to sticky-vec; `consensus.stale=true` is set on all SSE events.
- Dashboard shows the stale indicator. No data loss.
- Check semantic sidecar logs: `docker compose logs semantic-1 semantic-2`
- Common causes: OOM kill (model too large for container), Python exception loop.
- Breaker auto-closes after `BREAKER_TIMEOUT` (default 5 s half-open probe).

### `DropRateNonZero`

| Stage | Cause | Fix |
|---|---|---|
| `rawIn` | WS ingest overloaded | Add Sentinel replicas or reduce speaker count |
| `toEmbedder` | Embed queue backed up | Scale semantic sidecars or increase `EmbedFlushEvery` |
| `toShard` | Should never drop | Check Firestore throttling; inspect WAL size |

### `FirestoreWriteQuota70`

- Verify shard max events cap is set (default 50).
- If legitimate load, request quota increase in GCP console before reaching 100%.

---

## WAL replay

If Sentinel restarted while Firestore was unavailable, WAL files may exist:

```sh
ls /var/lib/kanso/wal/
# e.g. /var/lib/kanso/wal/meet-abc123/wal.jsonl
```

WAL is replayed automatically on next startup per meeting. Monitor with:
```sh
docker compose logs sentinel | grep "wal replay"
```

---

## Chaos drill — kill semantic sidecar

```sh
docker compose stop semantic-1 semantic-2

# Expected within 5 s:
# - gobreaker: closed → open
# - kanso_breaker_open gauge = 1
# - kanso_sticky_vec_fallback_total incrementing
# - SSE events: stale=true
# - E2E latency stays below 2 s SLO

docker compose start semantic-1 semantic-2
# Breaker half-opens after BREAKER_TIMEOUT (5 s) and closes on successful probes
```

---

## Load test

Requires [k6](https://k6.io/docs/get-started/installation/).

```sh
SENTINEL_WS=ws://localhost:8080/ws \
MEETING_ID=loadtest-$(date +%s) \
k6 run tests/load/k6/100-speakers.js
```

Pass criteria: p95 e2e < 2000 ms, p99 < 3500 ms, ws_errors < 10, toShard drops = 0.

---

## Cutting a release

```sh
git tag v0.2.0
git push origin v0.2.0
# CI: attribution check → docker build → image push → GitHub release
```

See [release-v0.1.0.md](release-v0.1.0.md) for the full pre-release gate checklist.

---

## KMS key rotation (GCP production)

Terraform sets a 90-day automatic rotation schedule. To force rotation:

```sh
gcloud kms keys versions create \
  --key=redaction \
  --keyring=kanso \
  --location=us-central1
# Old version remains active for decryption; new version used for all new DEKs.
```
