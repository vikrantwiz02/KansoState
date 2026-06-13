"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic, MicOff, Send, Wifi, WifiOff, Loader2,
  AlertCircle, CheckCircle2, Download,
} from "lucide-react";
import { useWhisperFallback } from "@/lib/useWhisperFallback";

interface Props {
  meetingId: string;
  speakerId: string;
  autoListen?: boolean;
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

export function LiveInput({ meetingId, speakerId, autoListen }: Props) {
  const [text, setText] = useState("");
  const [wsState, setWsState] = useState<WSState>("connecting");
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [partialText, setPartialText] = useState<string | null>(null);

  // Stable ref keeps Whisper's transcript callback from going stale.
  // Defined before whisper hook so the hook can close over it safely.
  const sendUtteranceRef = useRef<(t: string) => void>(() => {});

  const whisper = useWhisperFallback(useCallback((transcript: string) => {
    sendUtteranceRef.current(transcript);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  // Audio level
  const [audioLevel, setAudioLevel] = useState(0);
  const analyserRef    = useRef<AnalyserNode | null>(null);
  const animFrameRef   = useRef<number>(0);
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  const wsRef           = useRef<WebSocket | null>(null);
  const seqRef          = useRef(1);
  const recognitionRef  = useRef<any>(null);
  // Set to true when the user deliberately stops; prevents the onend auto-restart.
  const intentionalStop = useRef(false);

  useEffect(() => {
    setSpeechSupported(
      typeof window !== "undefined" &&
        ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
    );
  }, []);

  // WebSocket connection with automatic exponential-backoff reconnect.
  useEffect(() => {
    let cancelled = false;
    let retryMs = 1_000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      setWsState("connecting");

      fetch(`/api/ws-ticket?meetingId=${encodeURIComponent(meetingId)}`)
        .then((r) => r.json())
        .then(({ url }: { url?: string }) => {
          if (cancelled || !url) return;
          const ws = new WebSocket(url);
          wsRef.current = ws;

          ws.onopen = () => {
            if (!cancelled) { setWsState("connected"); retryMs = 1_000; }
          };
          ws.onclose = () => {
            wsRef.current = null;
            if (!cancelled) {
              setWsState("disconnected");
              retryTimer = setTimeout(connect, retryMs);
              retryMs = Math.min(retryMs * 2, 30_000);
            }
          };
          ws.onerror = () => {
            // onerror is always followed by onclose — reconnect happens there.
            if (!cancelled) setWsState("error");
          };
        })
        .catch(() => {
          if (!cancelled) {
            setWsState("error");
            retryTimer = setTimeout(connect, retryMs);
            retryMs = Math.min(retryMs * 2, 30_000);
          }
        });
    }

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [meetingId]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      intentionalStop.current = true;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    };
  }, []);

  // Auto-start listening when the video call is joined; auto-stop when it ends.
  // Uses recognitionRef (always current) instead of `listening` state to avoid stale closure.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoListen) {
      autoStartedRef.current = false;
      if (recognitionRef.current) {
        intentionalStop.current = true;
        recognitionRef.current.stop();
        recognitionRef.current = null;
        cancelAnimationFrame(animFrameRef.current);
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;
        audioStreamRef.current?.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
        setAudioLevel(0);
        setListening(false);
      }
      return;
    }
    if (wsState === "connected" && !recognitionRef.current && !autoStartedRef.current && speechSupported) {
      autoStartedRef.current = true;
      void (async () => {
        await toggleMic();
        if (!recognitionRef.current) autoStartedRef.current = false;
      })();
    }

    // Whisper fallback for non-Chrome browsers
    if (autoListen && !speechSupported && wsState === "connected") {
      if (whisper.status === "idle") whisper.load();
      if (whisper.status === "ready" && !whisper.listening) void whisper.start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoListen, wsState, speechSupported, whisper.status, whisper.listening]);

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

  // Keep the Whisper callback ref in sync whenever sendUtterance changes identity.
  useEffect(() => { sendUtteranceRef.current = sendUtterance; }, [sendUtterance]);

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

    if (recognitionRef.current) {
      intentionalStop.current = true;
      recognitionRef.current.stop();
      recognitionRef.current = null;
      cancelAnimationFrame(animFrameRef.current);
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
      setPartialText(null);
      setAudioLevel(0);
      setListening(false);
      return;
    }

    const SR: any = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      setMicError("Web Speech API not supported. Please use Google Chrome.");
      return;
    }

    // Request mic for the audio-level visualiser; SpeechRecognition manages its own stream.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtxRef.current?.close().catch(() => {}); // close any previous context
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;
      startAudioLevelLoop(analyser);
    } catch (err: unknown) {
      const errName = err instanceof DOMException ? err.name : "";
      const isAccessDenied =
        errName === "NotAllowedError" || errName === "PermissionDeniedError" ||
        (err instanceof Error && (err.message.includes("denied") || err.message.includes("Permission")));

      if (isAccessDenied) {
        let permState: PermissionState | null = null;
        try {
          const p = await navigator.permissions.query({ name: "microphone" as PermissionName });
          permState = p.state;
        } catch {/* not supported in all browsers */}
        setMicError(permState === "granted" ? MIC_ERRORS["macos-blocked"] : MIC_ERRORS["not-allowed"]);
      } else {
        setMicError(MIC_ERRORS["audio-capture"]);
      }
      return;
    }

    const recognition: any = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;  // capture speech as it happens, not just on final
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      // Iterate from resultIndex — avoids reprocessing results from before a restart.
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript: string = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          sendUtterance(transcript);
          interim = "";
        } else {
          interim += transcript;
        }
      }
      setPartialText(interim || null);
    };
    recognition.onerror = (e: { error: string }) => {
      if (e.error !== "aborted") {
        setMicError(MIC_ERRORS[e.error] ?? `Speech error: ${e.error}`);
      }
      recognitionRef.current = null;
      autoStartedRef.current = false;
      setPartialText(null);
      cancelAnimationFrame(animFrameRef.current);
      setAudioLevel(0);
      setListening(false);
    };
    recognition.onend = () => {
      setPartialText(null);
      if (intentionalStop.current) {
        intentionalStop.current = false;
        return;
      }
      if (recognitionRef.current === recognition) {
        try {
          recognition.start();
        } catch {
          // start() failed (too soon after onend) — clear refs so auto-listen can recover.
          recognitionRef.current = null;
          autoStartedRef.current = false;
          setListening(false);
        }
      }
    };

    intentionalStop.current = false;
    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  }, [sendUtterance]); // `listening` removed — we use recognitionRef.current for the stop/start decision

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

      {/* Header row */}
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

      {/* ── WHISPER FALLBACK (non-Chrome browsers) ── */}
      {autoListen && !speechSupported && (
        <div className="space-y-2">
          {whisper.status === "idle" && (
            <button
              onClick={whisper.load}
              disabled={wsState !== "connected"}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-xs text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              Load transcription model (~40 MB, cached)
            </button>
          )}

          {whisper.status === "loading" && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
              <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin flex-shrink-0" />
              <div className="flex-1">
                <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                  <span>Downloading model…</span>
                  <span className="font-mono">{whisper.loadProgress}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${whisper.loadProgress}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {whisper.status === "ready" && (
            whisper.listening ? (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 pulse-live" />
                <span className="text-xs font-medium text-emerald-400 flex-1">Listening</span>
                <span className="text-[10px] text-slate-600">~3s chunks</span>
                <button
                  onClick={whisper.stop}
                  className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-400 px-2 py-0.5 rounded-lg hover:bg-red-500/10 transition-all"
                >
                  <MicOff className="w-3 h-3" /> Pause
                </button>
              </div>
            ) : (
              <button
                onClick={() => void whisper.start()}
                disabled={wsState !== "connected"}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] text-xs text-slate-400 hover:border-indigo-500/30 hover:text-indigo-300 disabled:opacity-40 transition-all"
              >
                <Mic className="w-3.5 h-3.5" /> Tap to resume listening
              </button>
            )
          )}

          {whisper.status === "error" && (
            <div className="flex gap-2 items-start p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">Transcription model failed to load. Use the text input below.</p>
            </div>
          )}

          {whisper.micError && (
            <div className="flex gap-2 items-start p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{whisper.micError}</p>
            </div>
          )}
        </div>
      )}

      {/* ── AUTO MODE: compact passive status bar ── */}
      {autoListen && speechSupported && (
        <div className="space-y-2">
          {listening ? (
            <div className="space-y-1.5">
              {/* Warn when mic is active but WS is down — utterances are being dropped */}
              {wsState !== "connected" && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                  <span className="text-[11px] text-amber-300">
                    {wsState === "connecting" ? "Reconnecting — utterances held…" : "Disconnected — utterances not reaching server"}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 pulse-live" />
                <span className="text-xs font-medium text-emerald-400">Listening</span>
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500 transition-all duration-75"
                    style={{ width: `${audioLevel * 100}%` }}
                  />
                </div>
                <button
                  onClick={toggleMic}
                  className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-400 px-2 py-0.5 rounded-lg hover:bg-red-500/10 transition-all flex-shrink-0"
                >
                  <MicOff className="w-3 h-3" /> Pause
                </button>
              </div>
              {/* Live partial transcript — shows what's being heard right now */}
              {partialText && (
                <div className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                  <span className="text-[11px] text-slate-500 italic">{partialText}</span>
                  <span className="inline-block w-0.5 h-3 bg-slate-500 ml-0.5 animate-pulse align-middle" />
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={toggleMic}
              disabled={wsState !== "connected"}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] text-xs text-slate-400 hover:border-indigo-500/30 hover:text-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <Mic className="w-3.5 h-3.5" />
              {wsState === "connecting" ? "Waiting for connection…" : "Tap to resume listening"}
            </button>
          )}
          {micError && (
            <div className="flex gap-2 items-start p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300 leading-relaxed">{micError}</p>
            </div>
          )}
        </div>
      )}

      {/* ── MANUAL MODE: full mic toggle button ── */}
      {!autoListen && speechSupported && (
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
            {listening ? <><MicOff className="w-4 h-4" /> Stop listening</> : <><Mic className="w-4 h-4" /> Start listening</>}
            {listening && <span className="w-1.5 h-1.5 rounded-full bg-red-400 pulse-live" />}
          </button>
          {listening && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-600">Level</span>
              <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-75"
                  style={{ width: `${audioLevel * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-600 font-mono w-8 text-right">{Math.round(audioLevel * 100)}%</span>
            </div>
          )}
          {micError && (
            <div className="flex gap-2 items-start p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300 leading-relaxed">{micError}</p>
            </div>
          )}
        </div>
      )}

      {/* Manual text input — always available as fallback */}
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
          }}
          placeholder={speechSupported ? "Or type manually…" : "Type an utterance…"}
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
        <div className="flex gap-2 items-center text-xs">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          <span className="truncate text-slate-500">Sent: <span className="text-slate-300 italic">&quot;{lastSent}&quot;</span></span>
        </div>
      )}

        {!autoListen && !speechSupported && (
          <p className="text-[11px] text-slate-600">
            Microphone requires Chrome or Edge. Use the text input on other browsers.
          </p>
        )}
    </div>
  );
}
