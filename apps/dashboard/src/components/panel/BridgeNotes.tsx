import type { BridgeNote, SSEEnvelope } from "@/lib/types";
import { Zap, TrendingDown, TrendingUp, User, GitMerge, Loader } from "lucide-react";

interface Props {
  events: SSEEnvelope[];
}

const tagMeta: Record<string, { icon: typeof Zap; color: string; bg: string; border: string }> = {
  diverging:      { icon: TrendingDown, color: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/20" },
  "speaker-drift":{ icon: User,         color: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/20" },
  "high-alignment":{ icon: TrendingUp,  color: "text-emerald-400",bg: "bg-emerald-500/10",border: "border-emerald-500/20" },
  converging:     { icon: GitMerge,     color: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
  "early-stage":  { icon: Loader,       color: "text-slate-400",  bg: "bg-slate-500/10",  border: "border-slate-500/20" },
};

export function BridgeNotes({ events }: Props) {
  const notes = events
    .filter((e) => e.type === "bridge")
    .map((e) => e.payload as BridgeNote)
    .slice(-6) // show most recent 6
    .reverse();

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-3">
          <Zap className="w-4 h-4 text-slate-600" />
        </div>
        <p className="text-xs text-slate-600">Notes will appear as the meeting progresses.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
      {notes.map((n, i) => {
        const firstTag = n.tags[0] ?? "early-stage";
        const meta = tagMeta[firstTag] ?? tagMeta["early-stage"];
        const Icon = meta.icon;
        return (
          <div
            key={i}
            className={`rounded-xl p-3.5 border ${meta.bg} ${meta.border} transition-all`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-3.5 h-3.5 ${meta.color} flex-shrink-0`} />
              <div className="flex gap-1.5 flex-wrap">
                {n.tags.map((tag) => (
                  <span
                    key={tag}
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${meta.color} bg-white/[0.06] border ${meta.border}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            {n.note && (
              <p className="text-xs text-slate-300 leading-relaxed">{n.note}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
