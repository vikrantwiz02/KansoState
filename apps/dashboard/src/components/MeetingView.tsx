"use client";

import { useState, useEffect, useRef } from "react";
import { connectSSE } from "@/lib/sse";
import { ConsensusGauge } from "@/components/gauge/ConsensusGauge";
import { SpeakerTimeline } from "@/components/timeline/SpeakerTimeline";
import { BridgeNotes } from "@/components/panel/BridgeNotes";
import { IntentGraph } from "@/components/flow/IntentGraph";
import { SpeakerPicker } from "@/components/SpeakerPicker";
import { LiveInput } from "@/components/LiveInput";
import { VideoCall } from "@/components/VideoCall";
import { strings } from "@/content/strings";
import type { MeetingSnapshot, SSEEnvelope, ConsensusEvent } from "@/lib/types";
import Link from "next/link";
import { ArrowLeft, Wifi, WifiOff, AlertTriangle, Copy, Check } from "lucide-react";

interface Props {
  initialSnapshot: MeetingSnapshot;
}

export function MeetingView({ initialSnapshot }: Props) {
  const [events, setEvents] = useState<SSEEnvelope[]>(initialSnapshot.events);
  const [score, setScore] = useState(initialSnapshot.consensus_score);
  const [stale, setStale] = useState(initialSnapshot.stale);
  const [connected, setConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<"timeline" | "graph">("timeline");
  const [speakerId, setSpeakerId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [callJoined, setCallJoined] = useState(false);
  const lastSeq = useRef(
    initialSnapshot.events.reduce((max, e) => Math.max(max, e.seq), 0)
  );

  // Restore speaker name from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`speaker:${initialSnapshot.meeting_id}`);
    if (saved) setSpeakerId(saved);
  }, [initialSnapshot.meeting_id]);

  function handleSpeakerConfirm(name: string) {
    localStorage.setItem(`speaker:${initialSnapshot.meeting_id}`, name);
    setSpeakerId(name);
  }

  useEffect(() => {
    const stop = connectSSE(
      initialSnapshot.meeting_id,
      lastSeq.current,
      (env) => {
        lastSeq.current = Math.max(lastSeq.current, env.seq);
        setEvents((prev) => [...prev, env]);
        if (env.type === "consensus") {
          const c = env.payload as ConsensusEvent;
          setScore(c.score);
          setStale(c.stale);
        }
      },
      () => setConnected(false),
      () => setConnected(true)   // fires when EventSource opens — not on first event
    );
    return stop;
  }, [initialSnapshot.meeting_id]);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-[#070810] text-slate-100">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="orb-a absolute top-[-120px] left-[-60px] w-[600px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(99,102,241,0.45) 0%, transparent 65%)", filter: "blur(90px)" }}
        />
        <div
          className="orb-b absolute bottom-0 right-[5%] w-[400px] h-[400px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.3) 0%, transparent 65%)", filter: "blur(80px)" }}
        />
      </div>
      <div className="fixed inset-0 dot-grid pointer-events-none" />

      {/* Speaker name picker overlay */}
      {!speakerId && (
        <SpeakerPicker onConfirm={handleSpeakerConfirm} />
      )}

      {/* Nav */}
      <nav className="relative z-10 flex items-center gap-3 px-6 py-4 border-b border-white/[0.06]">
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Meetings
        </Link>
        <span className="text-slate-700">/</span>
        <span className="text-sm font-medium text-slate-300 truncate max-w-[220px]">
          {initialSnapshot.meeting_id}
        </span>

        {/* Copy invite link */}
        <button
          onClick={copyLink}
          className="ml-1 flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-300 transition-colors"
          title="Copy meeting link to invite others"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied!" : "Invite"}
        </button>

        <div className="ml-auto flex items-center gap-3">
          {stale && (
            <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 px-3 py-1 rounded-full">
              <AlertTriangle className="w-3 h-3" />
              {strings.meeting.stale}
            </div>
          )}
          <div
            className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border ${
              connected
                ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
                : "text-slate-500 bg-white/[0.03] border-white/[0.06]"
            }`}
          >
            {connected ? (
              <><Wifi className="w-3 h-3" /> {strings.meeting.live}</>
            ) : (
              <><WifiOff className="w-3 h-3" /> Connecting…</>
            )}
          </div>
        </div>
      </nav>

      {/* Body */}
      <div className="relative z-10 max-w-[1300px] mx-auto px-6 py-6">
        <div className="grid grid-cols-12 gap-5">
          {/* Left column */}
          <div className="col-span-12 lg:col-span-4 space-y-5">
            {/* Consensus gauge */}
            <div className="glass rounded-2xl p-6">
              <h2 className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-5">
                {strings.meeting.consensus}
              </h2>
              <ConsensusGauge score={score} stale={stale} />
            </div>

            {/* Bridge notes */}
            <div className="glass rounded-2xl p-6">
              <h2 className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-4">
                {strings.meeting.bridge}
              </h2>
              <BridgeNotes events={events} />
            </div>

            {/* Live input — only shown after name is picked */}
            {speakerId && (
              <LiveInput meetingId={initialSnapshot.meeting_id} speakerId={speakerId} autoListen={callJoined} />
            )}
          </div>

          {/* Right column */}
          <div className="col-span-12 lg:col-span-8 space-y-5">
            {/* Live video call */}
            {speakerId && (
              <VideoCall meetingId={initialSnapshot.meeting_id} peerId={speakerId} onJoinedChange={setCallJoined} />
            )}

            {/* Timeline / Intent graph */}
            <div className="glass rounded-2xl overflow-hidden">
              <div className="flex border-b border-white/[0.06]">
                {(["timeline", "graph"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-5 py-3.5 text-xs font-medium uppercase tracking-widest transition-colors ${
                      activeTab === tab
                        ? "text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/[0.04]"
                        : "text-slate-500 hover:text-slate-300 border-b-2 border-transparent"
                    }`}
                  >
                    {tab === "timeline" ? strings.meeting.timeline : "Intent Graph"}
                  </button>
                ))}
              </div>
              <div className="p-5">
                {activeTab === "timeline" ? (
                  <SpeakerTimeline events={events} />
                ) : (
                  <IntentGraph events={events} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
