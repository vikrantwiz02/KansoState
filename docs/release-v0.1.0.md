# Release Checklist — v0.1.0

## Pre-release gates (all must pass)

### CI
- [ ] `ci-sentinel-go` green on `main`
- [ ] `ci-semantic-py` green on `main`
- [ ] `ci-dashboard` green on `main`
- [ ] `ci-infra` green on `main`
- [ ] `nightly` bench gate: `BenchmarkConsensus_Update` ≤ 200 ns/op

### Load test
- [ ] `k6 run tests/load/k6/100-speakers.js` passes all thresholds:
  - p95 e2e < 2000 ms
  - p99 e2e < 3500 ms
  - ws_errors < 10
  - toShard drops = 0

### Chaos drill
- [ ] `k6 run tests/load/k6/chaos-sticky-vec.js` while killing semantic replicas:
  - Sentinel stays up
  - `stale_events` counter increments (sticky-vec activated)
  - p95 e2e < 2000 ms throughout

### Security
- [ ] Trivy scan: no HIGH/CRITICAL in sentinel or semantic images
- [ ] `docs/security-review.md` reviewed and signed off
- [ ] Outstanding items in security-review checked: IAP, rate limit, CSP
- [ ] KMS key created in production; `REDACTION_KMS_KEY_ID` set in Cloud Run

### Infrastructure
- [ ] `terraform apply` completes cleanly on production project
- [ ] Firestore backup schedule active
- [ ] BigQuery tables created with correct schema and partition config
- [ ] GCS redaction map bucket created with versioning and retention policy

### Observability
- [ ] All four Grafana dashboards load in production
- [ ] SLO alert rules firing correctly in staging under synthetic load
- [ ] `kanso_breaker_open` alert tested (kill sidecar → alert fires within 30 s)

### Attribution
- [ ] `scripts/check-attribution.sh` passes on release tag diff

## Tagging

```sh
git tag v0.1.0
git push origin v0.1.0
# release.yml runs and creates GitHub release with notes
```

## Rollback

```sh
# Roll back Cloud Run services to previous revision:
gcloud run services update-traffic kanso-sentinel-production \
  --to-revisions=PREVIOUS_REVISION=100 --region=us-central1
```
