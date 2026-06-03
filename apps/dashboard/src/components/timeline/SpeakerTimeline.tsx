"use client";

import { useRef, useEffect, useState } from "react";
import type { SSEEnvelope, UtterancePayload } from "@/lib/types";
import { MessageCircle, ChevronDown } from "lucide-react";

interface Props {
  events: (SSEEnvelope & { clientTs?: number })[];
}

const SPEAKER_PALETTE = [
  { bg: "bg-indigo-500/15",  border: "border-indigo-500/30",  dot: "#818cf8", name: "text-indigo-300" },
  { bg: "bg-violet-500/15",  border: "border-violet-500/30",  dot: "#a78bfa", name: "text-violet-300" },
  { bg: "bg-cyan-500/15",    border: "border-cyan-500/30",    dot: "#38bdf8", name: "text-cyan-300" },
  { bg: "bg-rose-500/15",    border: "border-rose-500/30",    dot: "#fb7185", name: "text-rose-300" },
  { bg: "bg-emerald-500/15", border: "border-emerald-500/30", dot: "#34d399", name: "text-emerald-300" },
  { bg: "bg-amber-500/15",   border: "border-amber-500/30",   dot: "#fbbf24", name: "text-amber-300" },
  { bg: "bg-pink-500/15",    border: "border-pink-500/30",    dot: "#f472b6", name: "text-pink-300" },
  { bg: "bg-teal-500/15",    border: "border-teal-500/30",    dot: "#2dd4bf", name: "text-teal-300" },
];

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function SpeakerTimeline({ events }: Props) {
  const scrollRef   = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newCount,  setNewCount]  = useState(0);
  const prevLen     = useRef(0);
  // -1 = not yet initialised. On first render we set it to the current length so
  // historical messages don't animate; only messages arriving after mount do.
  const animatedUpTo = useRef(-1);

  const utterances = events
    .filter((e) => e.type === "utterance")
    .map((e) => ({ ...(e.payload as UtterancePayload), clientTs: e.clientTs }));

  // Auto-scroll or increment unread counter
  useEffect(() => {
    const added = utterances.length - prevLen.current;
    if (added <= 0) return;
    prevLen.current = utterances.length;
    const el = scrollRef.current;
    if (!el) return;
    if (atBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      setNewCount((c) => c + added);
    }
  }, [utterances.length, atBottom]);

  // Initial scroll to bottom on mount
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAtBottom(near);
    if (near) setNewCount(0);
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setAtBottom(true);
    setNewCount(0);
  }

  // On first render: set threshold to current length so historical items don't animate.
  // On subsequent renders: threshold stays at last-seen length; only new items animate.
  if (animatedUpTo.current === -1) animatedUpTo.current = utterances.length;
  const newFromIndex = animatedUpTo.current;
  animatedUpTo.current = utterances.length;

  if (utterances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-3">
          <MessageCircle className="w-4 h-4 text-slate-600" />
        </div>
        <p className="text-xs text-slate-600">Waiting for utterances…</p>
      </div>
    );
  }

  const speakers = Array.from(new Set(utterances.map((u) => u.speaker_id)));
  const paletteMap = Object.fromEntries(
    speakers.map((s, i) => [s, SPEAKER_PALETTE[i % SPEAKER_PALETTE.length]])
  );

  // Participation stats
  const counts = utterances.reduce<Record<string, number>>((acc, u) => {
    acc[u.speaker_id] = (acc[u.speaker_id] ?? 0) + 1;
    return acc;
  }, {});
  const total = utterances.length;

  return (
    <div className="space-y-3">
      {/* Speaker participation bars */}
      {speakers.length > 0 && (
        <div className="space-y-1.5 pb-3 border-b border-white/[0.06]">
          <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-2">Participation</div>
          {speakers.map((s) => {
            const p   = paletteMap[s];
            const pct = total > 0 ? ((counts[s] ?? 0) / total) * 100 : 0;
            return (
              <div key={s} className="flex items-center gap-2">
                <span className={`text-[10px] font-medium w-14 truncate ${p.name}`}>{s}</span>
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, background: p.dot }}
                  />
                </div>
                <span className="text-[10px] text-slate-600 font-mono w-7 text-right">{Math.round(pct)}%</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="space-y-2 max-h-[420px] overflow-y-auto pr-1"
      >
        {utterances.map((u, i) => {
          const p  = paletteMap[u.speaker_id];
          const isNew = i >= newFromIndex;
          return (
            <div
              key={u.seq}
              className={`flex gap-3 p-3 rounded-xl ${p.bg} border ${p.border} ${isNew ? "animate-slideInUp" : ""}`}
            >
              <div
                className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: p.dot, boxShadow: `0 0 6px ${p.dot}60` }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-semibold ${p.name}`}>{u.speaker_id}</span>
                  {u.clientTs && (
                    <span className="text-[10px] text-slate-600 font-mono">{formatTime(u.clientTs)}</span>
                  )}
                  <span className="ml-auto text-[10px] font-mono text-slate-700">#{u.seq}</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed break-words">{u.redacted_text}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Scroll-to-bottom button */}
      {!atBottom && (
        <button
          onClick={scrollToBottom}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-lg hover:bg-indigo-500/20 transition-all"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          {newCount > 0 ? `${newCount} new message${newCount !== 1 ? "s" : ""}` : "Scroll to bottom"}
        </button>
      )}
    </div>
  );
}
