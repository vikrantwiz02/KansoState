# ADR 0003: Vector clocks for utterance ordering

**Status:** Accepted

## Decision

Use logical vector clocks (not wall-clock timestamps) for partial-order determination. Wall clock is used only as a tie-break in the deterministic total order.

## Rationale

- Mobile clients have significant clock skew (±500 ms common on cellular)
- Vector clocks give a provably correct causal partial order regardless of network jitter
- Total order for storage: `(topo rank, arrivedAtServer asc, sha256(utteranceId))` — last field is deterministic under any replay

## Trade-offs

- Slightly more complex merge logic vs. timestamp ordering
- Clock state grows with participant count — bounded by max participants per meeting (~100)
