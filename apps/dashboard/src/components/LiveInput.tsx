"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic, MicOff, Send, Wifi, WifiOff, Loader2,
  AlertCircle, CheckCircle2,
} from "lucide-react";

interface Props {
  meetingId: string;
  speakerId: string;
}

type WSState = "connecting" | "connected" | "disconnected" | "error";

const MIC_ERRORS: Record<string, string> = {
  "not-allowed":  "Chrome blocked the microphone. Click the 🔒 lock icon in the address bar → set Microphone to Allow → click this button again.",
  "macos-blocked":"macOS is blocking Chrome's microphone access. Open System Settings → Privacy & Security → Microphone → enable Google Chrome, then click this button again.",
  "no-speech":    "No speech detected. Try speaking louder or closer to the mic.",
  "network":      "Speech recognition network error. Check your internet connection.",
  "audio-capture":"No microphone found. Make sure one is connected and not in use.",
  "aborted":      "Listening stopped.",
};

export function LiveInput({ meetingId, speakerId }: Props) {
  const [text, setText] = useState("");
  const [wsState, setWsState] = useState<WSState>("connecting");
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [lastSent, setLastSent] = useState<string | null>(null);

  // Audio level
  const [audioLevel, setAudioLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);

  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    setSpeechSupported(
      typeof window !== "undefined" &&
        ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
    );
  }, []);

  // WebSocket connection (API key stays server-side)
  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;

    fetch(`/api/ws-ticket?meetingId=${encodeURIComponent(meetingId)}`)
      .then((r) => r.json())
      .then(({ url }) => {
        if (cancelled || !url) return;
        ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => { if (!cancelled) setWsState("connected"); };
        ws.onclose = () => { if (!cancelled) setWsState("disconnected"); };
        ws.onerror = () => { if (!cancelled) setWsState("error"); };
      })
      .catch(() => { if (!cancelled) setWsState("error"); });

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [meetingId]);

  useEffect(() => {
    return () => { cancelAnimationFrame(animFrameRef.current); };
  }, []);

  const sendUtterance = useCallback(
    (utteranceText: string) => {
      const trimmed = utteranceText.trim();
      if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const msg = {
        type: "text_chunk",
        meeting_id: meetingId,
        speaker_id: speakerId,
        seq: seqRef.current++,
        ts_client_ms: Date.now(),
        payload: trimmed,
      };
      wsRef.current.send(JSON.stringify(msg));
      setSentCount((n) => n + 1);
      setLastSent(trimmed);
    },
    [meetingId, speakerId]
  );

  // Audio level animation loop
  function startAudioLevelLoop(analyser: AnalyserNode) {
    const buf = new Uint8Array(analyser.frequencyBinCount);
    function loop() {
      analyser.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      setAudioLevel(Math.min(1, avg / 80));
      animFrameRef.current = requestAnimationFrame(loop);
    }
    loop();
  }

  const toggleMic = useCallback(async () => {
    setMicError(null);

    if (listening) {
      recognitionRef.current?.stop();
      cancelAnimationFrame(animFrameRef.current);
      setAudioLevel(0);
      setListening(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR: any = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      setMicError("Web Speech API not supported. Please use Google Chrome.");
      return;
    }

    // Request mic permission first so we can show a clear error
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Wire up audio level visualiser
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;
      startAudioLevelLoop(analyser);
      // Stop the raw stream — SpeechRecognition opens its own
      stream.getTracks().forEach((t) => t.stop());
    } catch (err: unknown) {
      const errName = err instanceof DOMException ? err.name : "";
      const isAccessDenied =
        errName === "NotAllowedError" || errName === "PermissionDeniedError" ||
        (err instanceof Error && (err.message.includes("denied") || err.message.includes("Permission")));

      if (isAccessDenied) {
        // Check if Chrome itself has "granted" permission — if so, macOS is blocking Chrome at OS level
        let permState: PermissionState | null = null;
        try {
          const p = await navigator.permissions.query({ name: "microphone" as PermissionName });
          permState = p.state;
        } catch { /* not supported in all browsers */ }

        if (permState === "granted") {
          setMicError(MIC_ERRORS["macos-blocked"]);
        } else {
          setMicError(MIC_ERRORS["not-allowed"]);
        }
      } else {
        setMicError(MIC_ERRORS["audio-capture"]);
      }
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) sendUtterance(last[0].transcript);
    };
    recognition.onerror = (e: { error: string }) => {
      if (e.error !== "aborted") {
        setMicError(MIC_ERRORS[e.error] ?? `Speech error: ${e.error}`);
      }
      cancelAnimationFrame(animFrameRef.current);
      setAudioLevel(0);
      setListening(false);
    };
    recognition.onend = () => {
      // Auto-restart if we're still supposed to be listening
      if (recognitionRef.current === recognition && listening) {
        try { recognition.start(); } catch { setListening(false); }
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  }, [listening, sendUtterance]);

  function handleSubmit() {
    sendUtterance(text);
    setText("");
  }

  const wsColors: Record<WSState, string> = {
    connecting:   "text-amber-400 bg-amber-500/10 border-amber-500/20",
    connected:    "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    disconnected: "text-slate-500 bg-white/[0.03] border-white/[0.06]",
    error:        "text-red-400 bg-red-500/10 border-red-500/20",
  };

  return (
    <div className="glass rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-0.5">Your input</div>
            <div className="text-xs text-slate-400">
              Speaking as{" "}
              <span className="text-indigo-400 font-semibold">{speakerId}</span>
              <span className="text-slate-600 ml-2 font-mono">· {sentCount} sent</span>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${wsColors[wsState]}`}>
            {wsState === "connecting" ? <Loader2 className="w-3 h-3 animate-spin" />
              : wsState === "connected" ? <Wifi className="w-3 h-3" />
              : <WifiOff className="w-3 h-3" />}
            {wsState}
          </div>
        </div>

        {/* Mic button */}
        {speechSupported && (
          <div className="space-y-2">
            <button
              onClick={toggleMic}
              disabled={wsState !== "connected"}
              className={`w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl border text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                listening
                  ? "bg-red-500/15 border-red-500/40 text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.2)]"
                  : "bg-white/[0.04] border-white/[0.08] text-slate-300 hover:border-indigo-500/40 hover:bg-indigo-500/[0.06]"
              }`}
            >
              {listening ? (
                <><MicOff className="w-4 h-4" /> Stop listening</>
              ) : (
                <><Mic className="w-4 h-4" /> Start listening (mic)</>
              )}
              {listening && <span className="w-1.5 h-1.5 rounded-full bg-red-400 pulse-live" />}
            </button>

            {/* Audio level bar */}
            {listening && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-600">Level</span>
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-75"
                    style={{ width: `${audioLevel * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-600 font-mono w-8 text-right">
                  {Math.round(audioLevel * 100)}%
                </span>
              </div>
            )}

            {/* Mic error */}
            {micError && (
              <div className="flex gap-2 items-start p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-300 leading-relaxed">{micError}</p>
              </div>
            )}
          </div>
        )}

        {/* Manual text input */}
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={speechSupported ? "Or type an utterance…" : "Type an utterance…"}
            disabled={wsState !== "connected"}
            className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:bg-indigo-500/[0.03] disabled:opacity-40 transition-all"
          />
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || wsState !== "connected"}
            className="px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        {/* Last sent confirmation */}
        {lastSent && (
          <div className="flex gap-2 items-center text-xs text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate text-slate-400">Sent: <span className="text-slate-300 italic">"{lastSent}"</span></span>
          </div>
        )}

        {!speechSupported && (
          <p className="text-[11px] text-slate-600">
            Microphone requires Chrome or Edge. Use the text input on other browsers.
          </p>
        )}
    </div>
  );
}
