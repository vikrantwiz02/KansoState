# ADR 0004: Attribution policy

**Status:** Accepted, non-negotiable

## Decision

No file, commit, comment, log line, README, package metadata, or UI string may reference specific AI tooling, generation methods, or carry assistant-related commit trailers.

## Enforcement

- `.attribution-denylist` lists all forbidden strings
- `scripts/check-attribution.sh` scans every CI diff; violation fails the build immediately (first step)
- Pre-commit hook strips forbidden trailers before commit

## Rationale

Product credibility, IP clarity, and customer trust require that all shipped code is owned and vouched for by the engineering team.
