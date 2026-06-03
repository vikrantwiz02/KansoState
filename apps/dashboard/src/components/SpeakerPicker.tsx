"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Users, ArrowRight } from "lucide-react";

interface Props {
  onConfirm: (name: string) => void;
}

export function SpeakerPicker({ onConfirm }: Props) {
  const { data: session } = useSession();
  const [name, setName] = useState("");

  // Pre-fill with first name from Google account once session loads.
  // Only fills if the user hasn't typed anything yet.
  useEffect(() => {
    if (session?.user?.name && name === "") {
      setName(session.user.name.split(" ")[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

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
          className="w-full bg-white/[0.04] border border-white/[0.10] rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 focus:bg-indigo-500/[0.04] transition-all mb-6"
        />

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
