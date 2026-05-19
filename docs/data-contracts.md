# Data Contracts

## WebSocket: Client → Sentinel

**Inbound message** (`/ws`):
```json
{
  "type": "text_chunk",
  "meeting_id": "meet-abc123",
  "speaker_id": "alice",
  "seq": 42,
  "ts_client_ms": 1716000000000,
  "payload": "let's align on Q3 before sprint review"
}
```

**Acknowledgment** (Sentinel → client):
```json
{ "ack_seq": 42, "server_ts_ms": 1716000000023, "lag_ms": 23 }
```

## HTTP: Sentinel → Semantic sidecar

**POST /embed** — batched, PII-redacted:
```json
{
  "texts": ["[EMAIL_1] please confirm", "let's ship Friday"],
  "model_hint": "all-MiniLM-L6-v2",
  "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
}
```
Response:
```json
{ "vectors": [[...384 floats...], [...384 floats...]], "model": "all-MiniLM-L6-v2", "took_ms": 41 }
```

**POST /classify-culture** — throttled to once per meeting per 30 s:
```json
{ "window": ["[NAME_1] prefers indirect approach", "let's take this offline"], "lang_hint": "ja", "meeting_id": "meet-abc123" }
```
Response:
```json
{ "tags": ["high-context", "indirect"], "bridge_note": "Speaker prefers indirect framing; confirm action items explicitly.", "took_ms": 180 }
```

## SSE: Sentinel → Dashboard (`/sse?meetingId=...`)

Stream of newline-terminated SSE events, `id` = sequence number:
```
id: 142
event: utterance
data: {"type":"utterance","meeting_id":"meet-abc123","payload":{...},"seq":142}

id: 143
event: consensus
data: {"type":"consensus","meeting_id":"meet-abc123","payload":{"score":0.72,"delta":0.03,"stale":false},"seq":143}

id: 144
event: heartbeat
data: {"type":"heartbeat","seq":144}
```

Clients reconnect with `Last-Event-Id: 143`; the 60-second ring buffer replays from that point.

Shutdown signal: `event: shutdown` — client should not reconnect.

## REST: Dashboard → Sentinel

**GET /api/v1/meetings/:id/hydrate** — cold load for SSR:
```json
{
  "meeting_id": "meet-abc123",
  "events": [ ...SSEEnvelope[] last 60 s... ],
  "vclock": { "alice": 42, "bob": 37 },
  "consensus_score": 0.72,
  "stale": false
}
```
Hard timeout: 200 ms. Response served from in-process hot-store only.

## Firestore schema

| Collection | Document | Fields |
|------------|----------|--------|
| `meetings` | `{meetingId}` | title, createdAt, endedAt, participants[], state, lastShardIndex |
| `meetings/{id}/shards` | `{shardId}` | meetingId, shardIndex, startTs, endTs, events[], writeCount |
| `meetings/{id}/control` | `finalized` | finalizedAt, meetingId — triggers Cloud Function |

`shardId` format: `{epochSec/10}-{rand4hex}` (e.g. `171600000-3fa2`)

## BigQuery tables (`kanso_analytics` dataset)

| Table | Partition | Cluster |
|-------|-----------|---------|
| `meetings` | — | — |
| `utterances` | DAY(arrived_at) | (meeting_id, speaker_id) |
| `consensus_timeseries` | DAY(ts) | — |

No PII in BigQuery — only redacted text and placeholder hashes.

## Channel sizing (Sentinel internal)

| Channel | Buffer | Overflow policy |
|---------|--------|----------------|
| `rawIn` (WS→ingest) | 4096 | Drop oldest + metric |
| `decoded` (ingest→workers) | 2048 | Drop + metric |
| `redacted` (workers→fanout) | 2048 | Block ingest (backpressure signal) |
| `toEmbedder` | 1024 | Drop oldest; sticky-vec fallback |
| `toConsensus` | 2048 | In-process; never blocks |
| `toShard` | 4096 | **Block** (durability) |
| `toSSE` per subscriber | 1024 | Drop oldest per slow subscriber |
