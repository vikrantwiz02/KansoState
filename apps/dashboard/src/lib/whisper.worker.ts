// This file runs inside a Web Worker — excluded from the main tsconfig to avoid
// DOM / WebWorker type conflicts. Webpack compiles it as a separate bundle.
/* eslint-disable */

import { pipeline, env } from "@xenova/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true; // cache model in IndexedDB after first download

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let transcriber: any = null;

ctx.addEventListener("message", async (e: MessageEvent) => {
  const { type } = e.data as { type: string };

  if (type === "load") {
    try {
      transcriber = await pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-tiny.en",
        {
          progress_callback: (p: any) => {
            ctx.postMessage({ type: "progress", payload: p });
          },
        }
      );
      ctx.postMessage({ type: "ready" });
    } catch (err) {
      ctx.postMessage({ type: "error", payload: String(err) });
    }
    return;
  }

  if (type === "transcribe" && transcriber) {
    const { audio, sampleRate } = e.data as { audio: Float32Array; sampleRate: number };
    try {
      const result: any = await transcriber(audio, { sampling_rate: sampleRate });
      const text: string = result?.text?.trim() ?? "";
      if (text) ctx.postMessage({ type: "result", payload: text });
    } catch (err) {
      ctx.postMessage({ type: "error", payload: String(err) });
    }
  }
});
