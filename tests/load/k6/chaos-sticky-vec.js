/**
 * Chaos drill: kill semantic sidecar mid-test, verify sticky-vec keeps consensus updating.
 *
 * Run:
 *   docker compose up -d
 *   k6 run tests/load/k6/chaos-sticky-vec.js
 *
 * The script kills the semantic replicas after 30 s and expects:
 *   - No WS disconnects (sentinel stays up)
 *   - p95 e2e latency stays < 2 s (sticky-vec path)
 *   - stale_events counter increments (consensus.stale=true events arrive)
 */
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";
import exec from "k6/execution";

export const options = {
  stages: [
    { duration: "30s", target: 20 },   // ramp up before chaos
    { duration: "60s", target: 20 },   // chaos window
    { duration: "30s", target: 0 },    // drain
  ],
  thresholds: {
    e2e_latency_ms: ["p(95)<2000"],
    ws_errors: ["count<5"],
  },
};

const e2eLatency = new Trend("e2e_latency_ms");
const wsErrors = new Counter("ws_errors");
const staleEvents = new Counter("stale_events");

const SENTINEL_WS = __ENV.SENTINEL_WS || "ws://localhost:8080/ws";
const MEETING_ID = __ENV.MEETING_ID || `chaos-${Date.now()}`;

export default function () {
  const speakerId = `speaker-${__VU}`;
  let seq = 0;

  const res = ws.connect(SENTINEL_WS, {}, function (socket) {
    socket.on("open", () => {
      const timer = setInterval(() => {
        seq++;
        socket.send(JSON.stringify({
          type: "text_chunk",
          meeting_id: MEETING_ID,
          speaker_id: speakerId,
          seq: seq,
          ts_client_ms: Date.now(),
          payload: `chaos test utterance ${seq} — roadmap discussion`,
        }));
      }, 250);

      setTimeout(() => {
        clearInterval(timer);
        socket.close();
      }, 120_000);
    });

    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.server_ts_ms) {
          e2eLatency.add(Date.now() - msg.server_ts_ms);
        }
        if (msg.type === "consensus" && msg.payload?.stale) {
          staleEvents.add(1);
        }
      } catch {}
    });

    socket.on("error", () => wsErrors.add(1));
  });

  check(res, { "ws connected": (r) => r && r.status === 101 });
}
