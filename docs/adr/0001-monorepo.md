# ADR 0001: Monorepo layout

**Status:** Accepted

## Decision

All services (sentinel-go, semantic-py, dashboard, infra) live in a single repository under versioned directories.

## Rationale

- Atomic cross-service changes (data contract updates touch sentinel + sidecar + dashboard simultaneously)
- Single CI attribution check covers all code paths
- Simplified local dev (`make dev-up` starts the full stack)

## Trade-offs

- Larger CI scope — mitigated by path-filtered workflows per service
- Shared git history — no isolation between service release cadences
