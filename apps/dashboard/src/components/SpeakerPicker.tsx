"use client";

import { useState } from "react";
import { Users, ArrowRight } from "lucide-react";

const SUGGESTED = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank"];

interface Props {
  onConfirm: (name: string) => void;
}

export function SpeakerPicker({ onConfirm }: Props) {
  const [name, setName] = useState("");

  function handleConfirm() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="glass rounded-2xl p-8 w-full max-w-sm glow-indigo">
        <div className="w-11 h-11 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center mb-5">
          <Users className="w-5 h-5 text-indigo-400" />
        </div>
        <h2 className="text-lg font-bold tracking-tight mb-1">Who are you in this meeting?</h2>
        <p className="text-sm text-slate-400 mb-6">
          Your name labels your utterances in the timeline and consensus graph.
        </p>

        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
          placeholder="Enter your name…"
          maxLength={32}
          className="w-full bg-white/[0.04] border border-white/[0.10] rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 focus:bg-indigo-500/[0.04] transition-all mb-4"
        />

        {/* Quick picks */}
        <div className="flex flex-wrap gap-2 mb-6">
          {SUGGESTED.map((s) => (
            <button
              key={s}
              onClick={() => setName(s)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
                name.toLowerCase() === s.toLowerCase()
                  ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                  : "bg-white/[0.03] border-white/[0.08] text-slate-400 hover:border-white/[0.14] hover:text-slate-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <button
          onClick={handleConfirm}
          disabled={!name.trim()}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold transition-all"
        >
          Join meeting <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
