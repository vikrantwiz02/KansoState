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

## Production deployment — Docker Compose + Tailscale + Cloudflare

This is the current production setup for **kansostate.vikrantkumar.site**.

### Architecture summary

```
Internet → Cloudflare (DNS proxy) → Cloudflare Worker
  → Tailscale Funnel (TLS, port 443)
    → Apache2 :80 (routing by X-Kanso-Target)
      → Docker containers (Dashboard :3010, Sentinel :8180, Grafana :3011)

WebSocket (wss://fusion-virtual-machine.taila689d6.ts.net):
  Browser → Tailscale Funnel directly (bypasses Worker)
    → Apache2 :80 → Sentinel :8180
```

### Server requirements

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB | 40 GB |
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |

### 1. Install Docker

```sh
sudo apt update && sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER && sudo systemctl enable docker
```

### 2. Install Apache2 with required modules

```sh
sudo apt install -y apache2
sudo a2enmod proxy proxy_http proxy_wstunnel ssl headers rewrite
sudo systemctl enable apache2
```

### 3. Install Tailscale and enable Funnel

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --authkey=YOUR_TAILSCALE_AUTH_KEY
sudo tailscale funnel --bg http://localhost:80
```

Verify Funnel is active:
```sh
tailscale funnel status
# Should show: https://fusion-virtual-machine.taila689d6.ts.net -> http://localhost:80
```

### 4. Configure Apache2

Copy the vhost configs:
```sh
sudo cp infra/apache/kansostate.conf /etc/apache2/sites-available/
sudo cp infra/apache/kansostate-tailscale.conf /etc/apache2/sites-available/
sudo a2ensite kansostate kansostate-tailscale
sudo a2dissite 000-default
sudo apache2ctl configtest && sudo systemctl restart apache2
```

`kansostate.conf` — routes by `ServerName` for direct connections  
`kansostate-tailscale.conf` — routes by `X-Kanso-Target` header (set by Cloudflare Worker) for Tailscale-proxied connections

### 5. Configure Cloudflare Worker

The Worker (`infra/cloudflare-worker/worker.js`) injects the `X-Kanso-Target` header and routes HTTPS traffic. Deploy via Cloudflare dashboard → Workers:

- Worker routes: `kansostate.vikrantkumar.site/*`, `grafana.kansostate.vikrantkumar.site/*`
- **Do not** add a Worker route for `api.kansostate.vikrantkumar.site/*` — WebSocket traffic goes directly to Tailscale

Set Worker environment variables (Settings → Variables):
```
TAILSCALE_FQDN = fusion-virtual-machine.taila689d6.ts.net
```

### 6. Set up environment

```sh
cd /path/to/KansoState
cp .env.example .env
```

Edit `.env`:
```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_SECRET=...            # openssl rand -base64 32
NEXTAUTH_URL=https://kansostate.vikrantkumar.site
SENTINEL_API_KEY=              # leave empty to disable auth (behind Tailscale)
SENTINEL_WS_URL=wss://fusion-virtual-machine.taila689d6.ts.net
SENTINEL_URL=http://sentinel:8080
SENTINEL_PUBLIC_URL=https://api.kansostate.vikrantkumar.site
GRAFANA_PASSWORD=changeme
```

> **Note:** `SENTINEL_API_KEY` is intentionally empty in production. The Sentinel is protected by the network boundary (only reachable via Tailscale/Apache). If you need auth, set the same value in both dashboard and sentinel environments.

### 7. Build and start

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Check all containers are healthy:
```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

### 8. Verify deployment

```sh
# Dashboard
curl -I https://kansostate.vikrantkumar.site

# Sentinel health
curl https://api.kansostate.vikrantkumar.site/healthz

# WebSocket (Tailscale direct)
curl -v -N \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  "https://fusion-virtual-machine.taila689d6.ts.net/ws?meetingId=test"
# Expected: HTTP/1.1 400 (upgrade rejected without valid meeting — correct)

# SSE endpoint (container-to-container)
docker exec kansostate-dashboard-1 \
  curl -s http://sentinel:8080/sse?meetingId=test
```

### 9. Google OAuth setup

In Google Cloud Console → APIs & Services → Credentials → OAuth Client:
- **Authorized JavaScript origins**: `https://kansostate.vikrantkumar.site`
- **Authorized redirect URIs**: `https://kansostate.vikrantkumar.site/api/auth/callback/google`

---

## Day-2 operations

### Restart a single service

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart dashboard
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart sentinel
```

### Rebuild after code change

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml build dashboard
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d dashboard
```

### View logs

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f sentinel
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f dashboard
sudo tail -f /var/log/apache2/kansostate-ts-access.log
sudo tail -f /var/log/apache2/kansostate-ts-error.log
```

### Check Apache routing

```sh
sudo apache2ctl -S          # show all vhosts
sudo apache2ctl -M | grep proxy  # verify proxy modules loaded
```

### Scale semantic sidecars

Add `semantic-3` in `docker-compose.yml` and add to `EMBEDDER_URLS`. Sentinel round-robins automatically.

---

## Alert response

### Alert: `kanso_drop_total` increasing

**Cause**: `toEmbedder` or `toSSE` channel full (not `toShard` — that blocks).  
**Action**: Check `kanso_queue_depth` metrics; if embedding sidecar is slow, check its logs. If channel overflow is sustained, scale the sidecar.

### Alert: `stale=true` in UI / consensus not updating

**Cause**: Circuit breaker tripped (embedding sidecar unreachable for 5+ failures).  
**Check**:
```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs semantic-1
curl http://localhost:8090/embed -X POST -H 'Content-Type: application/json' -d '{"texts":["test"]}'
```
**Action**: Restart sidecar; breaker auto-resets after 5 seconds in half-open state.

### Alert: Sentinel health check failing

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps sentinel
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs sentinel --tail=50
```

### Alert: WebSocket connections not establishing

1. Check Tailscale Funnel status: `tailscale funnel status`
2. Check Apache logs: `sudo tail -20 /var/log/apache2/kansostate-ts-error.log`
3. Verify `SENTINEL_WS_URL` in dashboard container: `docker exec kansostate-dashboard-1 env | grep SENTINEL_WS_URL`

### Alert: SSE "Connecting..." not resolving

**Cause**: Sentinel `SENTINEL_API_KEY` mismatch — Sentinel may have a key set while dashboard sends a different (or no) key.  
**Fix**: Set `SENTINEL_API_KEY=` (empty) in Sentinel's environment to disable auth:
```sh
# In docker-compose.prod.yml, under sentinel environment:
- SENTINEL_API_KEY=
# Then restart sentinel
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d sentinel
```

---

## Load testing

Requires [k6](https://k6.io/) and the full dev stack running.

```sh
SENTINEL_WS=ws://localhost:8080/ws \
MEETING_ID=loadtest-$(date +%s) \
k6 run tests/load/k6/100-speakers.js
```

Pass criteria: p95 e2e < 2000 ms, p99 < 3500 ms, `ws_errors` < 10, `toShard` drops = 0.
