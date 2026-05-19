"use client";

import type { SSEEnvelope } from "./types";

export type SSEHandler = (envelope: SSEEnvelope) => void;

export function connectSSE(
  meetingId: string,
  lastSeq: number,
  onEvent: SSEHandler,
  onDisconnect: () => void
): () => void {
  let es: EventSource | null = null;
  let retryMs = 1000;
  let stopped = false;

  function connect() {
    const url = `/api/stream/${encodeURIComponent(meetingId)}`;
    es = new EventSource(url);

    es.addEventListener("utterance", (e: MessageEvent) => {
      try {
        const env: SSEEnvelope = JSON.parse(e.data);
        onEvent(env);
        retryMs = 1000;
      } catch {}
    });

    es.addEventListener("consensus", (e: MessageEvent) => {
      try {
        onEvent(JSON.parse(e.data));
        retryMs = 1000;
      } catch {}
    });

    es.addEventListener("bridge", (e: MessageEvent) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {}
    });

    es.addEventListener("shutdown", () => {
      es?.close();
    });

    es.onerror = () => {
      es?.close();
      if (!stopped) {
        onDisconnect();
        setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
      }
    };
  }

  connect();
  return () => {
    stopped = true;
    es?.close();
  };
}
