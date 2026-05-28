# Features

## Video call

| Feature | Details |
|---|---|
| HD camera | 1920×1080 ideal, 1280×720 min, 30 fps |
| Noise cancellation | Browser `AudioContext` with `echoCancellation`, `noiseSuppression` |
| Grid view | Responsive 1 / 2 / 3-column, scales to any number of peers |
| Speaker / pin view | Click any tile to pin it full-width; others in scrollable sidebar |
| Fullscreen | Standard Fullscreen API; ESC exits |
| Screen share | Atomic `replaceTrack` across all peer connections; rollback on failure; camera auto-restores when browser stop-share fires |
| Auto-transcription | Speech recognition starts automatically when you join the call; the join click is the required browser gesture — no separate step |
| Mic / camera toggles | Mute / unmute and camera on / off without leaving the call |

## Meeting intelligence

| Feature | Details |
|---|---|
| Consensus gauge | −1 → +1 arc; cosine similarity + EMA α=0.2 over 384-dim sentence embeddings |
| Per-speaker drift | Detects when a speaker's semantic centroid shifts significantly from their baseline |
| Bridge notes | Auto-generated every 5 utterances: `converging`, `diverging`, `high-alignment`, `early-stage`, `speaker-drift` |
| Speaker timeline | Vector-clock causal ordering; color-coded per speaker |
| Intent graph | React Flow semantic topic cluster map; updates as meeting progresses |

## Transcription

| Feature | Details |
|---|---|
| Web Speech API | Chrome / Edge native; continuous recognition with auto-restart |
| Audio level visualiser | Real-time `AnalyserNode` FFT bar |
| Manual text input | Fallback for non-Chrome browsers or when mic is unavailable |
| PII redaction | Aho-Corasick + regex; only redacted text reaches embeddings and storage |
| Utterance confirmation | "Sent: …" display after each transmitted utterance |

## Infrastructure

| Feature | Details |
|---|---|
| Sub-2s end-to-end | Utterance → consensus render p95 < 2 s |
| Circuit breaker | Embedding sidecar down → sticky-vec consensus; `stale` badge; zero data loss |
| WAL | Write-ahead log; Firestore writes replayed on restart after crash |
| ICE candidate queuing | Candidates queued until `setRemoteDescription` completes; reliable WebRTC on high-latency paths |
| Hot-store SSE | 60-second ring buffer; dashboard reads never touch Firestore on the read path |
| Google OAuth | Single sign-on; all meeting routes protected |
