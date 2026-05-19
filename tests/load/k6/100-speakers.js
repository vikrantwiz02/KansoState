import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

export const options = {
  vus: 100,
  duration: "5m",
  thresholds: {
    e2e_latency_ms: ["p(95)<2000", "p(99)<3500"],
    ws_errors: ["count<10"],
  },
};

const e2eLatency = new Trend("e2e_latency_ms");
const wsErrors = new Counter("ws_errors");

const SENTINEL_WS = __ENV.SENTINEL_WS || "ws://localhost:8080/ws";
const MEETING_ID = __ENV.MEETING_ID || "load-test-meeting";

export default function () {
  const speakerId = `speaker-${__VU}`;

  const url = SENTINEL_WS;
  const res = ws.connect(url, {}, function (socket) {
    let seq = 0;
    const sendInterval = 250; // 4 utterances/sec = 250ms/utterance

    socket.on("open", () => {
      const timer = setInterval(() => {
        seq++;
        const msg = JSON.stringify({
          type: "text_chunk",
          meeting_id: MEETING_ID,
          speaker_id: speakerId,
          seq: seq,
          ts_client_ms: Date.now(),
          payload: `Speaker ${speakerId} utterance ${seq}: discussing Q3 priorities and roadmap alignment`,
        });
        socket.send(msg);
      }, sendInterval);

      // stop after 5 minutes
      setTimeout(() => {
        clearInterval(timer);
        socket.close();
      }, 300_000);
    });

    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.server_ts_ms) {
          const lag = Date.now() - msg.server_ts_ms;
          e2eLatency.add(lag);
        }
      } catch {}
    });

    socket.on("error", () => {
      wsErrors.add(1);
    });
  });

  check(res, { "ws connected": (r) => r && r.status === 101 });
}
