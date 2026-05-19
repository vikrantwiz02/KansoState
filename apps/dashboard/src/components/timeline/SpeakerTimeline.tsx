import type { SSEEnvelope, UtterancePayload } from "@/lib/types";
import { MessageCircle } from "lucide-react";

interface Props {
  events: SSEEnvelope[];
}

const SPEAKER_PALETTE = [
  { bg: "bg-indigo-500/15", border: "border-indigo-500/30", dot: "#818cf8", name: "text-indigo-300" },
  { bg: "bg-violet-500/15", border: "border-violet-500/30", dot: "#a78bfa", name: "text-violet-300" },
  { bg: "bg-cyan-500/15",   border: "border-cyan-500/30",   dot: "#38bdf8", name: "text-cyan-300" },
  { bg: "bg-rose-500/15",   border: "border-rose-500/30",   dot: "#fb7185", name: "text-rose-300" },
  { bg: "bg-emerald-500/15",border: "border-emerald-500/30",dot: "#34d399", name: "text-emerald-300" },
  { bg: "bg-amber-500/15",  border: "border-amber-500/30",  dot: "#fbbf24", name: "text-amber-300" },
  { bg: "bg-pink-500/15",   border: "border-pink-500/30",   dot: "#f472b6", name: "text-pink-300" },
  { bg: "bg-teal-500/15",   border: "border-teal-500/30",   dot: "#2dd4bf", name: "text-teal-300" },
];

export function SpeakerTimeline({ events }: Props) {
  const utterances = events
    .filter((e) => e.type === "utterance")
    .map((e) => e.payload as UtterancePayload);

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

  return (
    <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
      {utterances.map((u, i) => {
        const p = paletteMap[u.speaker_id];
        return (
          <div
            key={i}
            className={`flex gap-3 p-3 rounded-xl ${p.bg} border ${p.border} transition-all`}
          >
            <div
              className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: p.dot, boxShadow: `0 0 6px ${p.dot}80` }}
            />
            <div className="flex-1 min-w-0">
              <div className={`text-xs font-semibold mb-1 ${p.name}`}>
                {u.speaker_id}
                <span className="ml-2 text-[10px] font-mono text-slate-600 font-normal">#{u.seq}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed break-words">{u.redacted_text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
