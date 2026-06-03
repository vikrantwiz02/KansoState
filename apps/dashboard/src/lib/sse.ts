"use client";

import type { SSEEnvelope } from "./types";

export type SSEHandler = (envelope: SSEEnvelope) => void;

export function connectSSE(
  meetingId: string,
  lastSeq: number,
  onEvent: SSEHandler,
  onDisconnect: () => void,
  onConnect?: () => void
): () => void {
  let es: EventSource | null = null;
  let retryMs = 1000;
  let stopped = false;
  let currentSeq = lastSeq;

  function connect() {
    // Include last known seq so the server can resume from the right point.
    const url = `/api/stream/${encodeURIComponent(meetingId)}?lastSeq=${currentSeq}`;
    es = new EventSource(url);
    es.onopen = () => { if (!stopped) onConnect?.(); };

    function handle(e: MessageEvent) {
      try {
        const env: SSEEnvelope = JSON.parse(e.data);
        currentSeq = Math.max(currentSeq, env.seq);
        onEvent(env);
        retryMs = 1000;
      } catch { /* ignore malformed */ }
    }

    es.addEventListener("utterance", handle);
    es.addEventListener("consensus", handle);
    es.addEventListener("bridge", handle);

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
