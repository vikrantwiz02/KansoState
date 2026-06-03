"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type WhisperStatus = "idle" | "loading" | "ready" | "error";

export interface UseWhisperFallbackReturn {
  status: WhisperStatus;
  /** 0–100 download progress while status === "loading" */
  loadProgress: number;
  listening: boolean;
  micError: string | null;
  /** Call once to start downloading the model (~40 MB, cached after first load) */
  load: () => void;
  start: () => Promise<void>;
  stop: () => void;
}

export function useWhisperFallback(
  onTranscript: (text: string) => void
): UseWhisperFallbackReturn {
  const [status, setStatus]           = useState<WhisperStatus>("idle");
  const [loadProgress, setLoadProgress] = useState(0);
  const [listening, setListening]     = useState(false);
  const [micError, setMicError]       = useState<string | null>(null);

  const workerRef   = useRef<Worker | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const onCbRef     = useRef(onTranscript);
  onCbRef.current   = onTranscript; // always current without re-creating callbacks

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      stopRecorder();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopRecorder() {
    if (!recorderRef.current) return;
    try { recorderRef.current.stop(); } catch { /* already stopped */ }
    recorderRef.current.stream?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
  }

  // ── Load model ─────────────────────────────────────────────────────────────
  const load = useCallback(() => {
    if (workerRef.current || status !== "idle") return;
    setStatus("loading");
    setLoadProgress(0);

    const worker = new Worker(
      new URL("./whisper.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const { type, payload } = e.data as { type: string; payload: unknown };

      if (type === "progress") {
        const p = payload as Record<string, unknown>;
        if (typeof p.progress === "number") {
          setLoadProgress(Math.round(p.progress * 100));
        }
      } else if (type === "ready") {
        setStatus("ready");
      } else if (type === "result") {
        onCbRef.current(payload as string);
      } else if (type === "error") {
        console.error("Whisper worker:", payload);
        setStatus("error");
      }
    };

    worker.onerror = (e) => {
      console.error("Whisper worker crash:", e.message);
      setStatus("error");
    };

    worker.postMessage({ type: "load" });
  }, [status]);

  // ── Start recording ───────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (status !== "ready") return;
    setMicError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMicError("Microphone access denied. Please allow mic access and try again.");
      return;
    }

    // Pick the best available audio format
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", ""]
      .find((m) => !m || MediaRecorder.isTypeSupported(m)) ?? "";

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    recorderRef.current = recorder;

    recorder.ondataavailable = async (ev) => {
      // Skip near-silent/empty chunks
      if (ev.data.size < 1500) return;

      try {
        const arrayBuf = await ev.data.arrayBuffer();
        // Decode to PCM at 16 kHz (what Whisper expects)
        const ctx = new AudioContext({ sampleRate: 16_000 });
        const decoded = await ctx.decodeAudioData(arrayBuf);
        const audio = decoded.getChannelData(0); // mono Float32Array
        await ctx.close();

        // Transfer the buffer (zero-copy) to the worker
        workerRef.current?.postMessage(
          { type: "transcribe", audio, sampleRate: 16_000 },
          [audio.buffer]
        );
      } catch {
        /* decode failed — skip this chunk */
      }
    };

    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setListening(false);
    };

    recorder.start(3_000); // emit a chunk every 3 seconds
    setListening(true);
  }, [status]);

  // ── Stop recording ────────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stop = useCallback(() => {
    stopRecorder();
    setListening(false);
  }, []);

  return { status, loadProgress, listening, micError, load, start, stop };
}
