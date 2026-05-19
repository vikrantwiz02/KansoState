# ADR 0002: Firestore sharding strategy

**Status:** Accepted

## Decision

Roll a new shard every 10 seconds or 50 writes (whichever comes first). Shard IDs use the format `{epoch10s}-{rand4hex}` to avoid Firestore hotspot on a single document prefix.

## Rationale

- Firestore's auto-index on a single document would create a hotspot at 100 speakers × 4 utt/s = 400 writes/s
- 50-write shards cap the per-document payload; 4-char random suffix distributes across Firestore tablet splits
- Dashboard never reads live shards — reads go through the Sentinel hot-store (in-process ring buffer)

## Trade-offs

- Shard roll adds ~1 write per meeting per 10 s overhead
- On cold load of finished meetings, the hydrate path must read and merge shards (acceptable — finished meetings are not latency-sensitive)
