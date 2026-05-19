"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";

export function StartMeetingButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  function handleClick() {
    setLoading(true);
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 6);
    const id = `meeting-${ts}-${rand}`;
    router.push(`/meetings/${id}`);
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-sm font-semibold transition-all hover:shadow-[0_0_20px_rgba(99,102,241,0.4)]"
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Plus className="w-4 h-4" />
      )}
      Start meeting
    </button>
  );
}
