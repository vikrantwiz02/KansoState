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
import type { MeetingSnapshot, SSEEnvelope, ConsensusEvent, UtterancePayload } from "@/lib/types";
import Link from "next/link";
import { ArrowLeft, Wifi, WifiOff, AlertTriangle, Copy, Check, Clock, Users } from "lucide-react";

interface Props {
  initialSnapshot: MeetingSnapshot;
}

// Attach a client-side arrival timestamp to every event.
type TimestampedEnvelope = SSEEnvelope & { clientTs: number };

function stamp(env: SSEEnvelope): TimestampedEnvelope {
  return { ...env, clientTs: Date.now() };
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function MeetingView({ initialSnapshot }: Props) {
  const [events, setEvents] = useState<TimestampedEnvelope[]>(
    initialSnapshot.events.map(stamp)
  );
  const [score, setScore]         = useState(initialSnapshot.consensus_score);
  const [scoreDelta, setScoreDelta] = useState(0);
  const [scoreHistory, setScoreHistory] = useState<number[]>([]);
  const [stale, setStale]         = useState(initialSnapshot.stale);
  const [connected, setConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<"timeline" | "graph">("timeline");
  const [speakerId, setSpeakerId] = useState<string | null>(null);
  const [copied, setCopied]       = useState(false);
  const [elapsed, setElapsed]     = useState(0);
  const startTime = useRef<number>(Date.now());

  const lastSeq = useRef(
    initialSnapshot.events.reduce((max, e) => Math.max(max, e.seq), 0)
  );

  // Derived: unique speakers who have spoken
  const activeSpeakers = Array.from(
    new Set(
      events
        .filter((e) => e.type === "utterance")
        .map((e) => (e.payload as UtterancePayload).speaker_id)
    )
  );

  // Meeting timer
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Restore speaker name
  useEffect(() => {
    const saved = localStorage.getItem(`speaker:${initialSnapshot.meeting_id}`);
    if (saved) setSpeakerId(saved);
  }, [initialSnapshot.meeting_id]);

  function handleSpeakerConfirm(name: string) {
    localStorage.setItem(`speaker:${initialSnapshot.meeting_id}`, name);
    setSpeakerId(name);
  }

  // SSE stream
  useEffect(() => {
    const stop = connectSSE(
      initialSnapshot.meeting_id,
      lastSeq.current,
      (env) => {
        lastSeq.current = Math.max(lastSeq.current, env.seq);
        setEvents((prev) => [...prev, stamp(env)]);
        if (env.type === "consensus") {
          const c = env.payload as ConsensusEvent;
          setScoreDelta(c.delta ?? 0);
          setScore(c.score);
          setScoreHistory((h) => [...h.slice(-19), c.score]);
          setStale(c.stale);
        }
      },
      () => setConnected(false),
      () => setConnected(true),
    );
    return stop;
  }, [initialSnapshot.meeting_id]);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Pretty-print meeting ID: "meeting-1716000000000-ab12" → "ab12"
  const shortId = initialSnapshot.meeting_id.split("-").pop() ?? initialSnapshot.meeting_id;

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

      {!speakerId && <SpeakerPicker onConfirm={handleSpeakerConfirm} />}

      {/* Nav */}
      <nav className="relative z-10 flex items-center gap-3 px-6 py-3.5 border-b border-white/[0.06]">
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Meetings
        </Link>
        <span className="text-slate-700">/</span>
        <span className="text-sm font-mono font-medium text-slate-400">
          {shortId}
        </span>

        <button
          onClick={copyLink}
          className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-300 transition-colors"
          title="Copy invite link"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied!" : "Invite"}
        </button>

        <div className="ml-auto flex items-center gap-2.5">
          {/* Timer */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500 px-2.5 py-1 rounded-full bg-white/[0.03] border border-white/[0.06]">
            <Clock className="w-3 h-3" />
            <span className="font-mono tabular-nums">{formatDuration(elapsed)}</span>
          </div>

          {/* Active speakers */}
          {activeSpeakers.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 px-2.5 py-1 rounded-full bg-white/[0.03] border border-white/[0.06]">
              <Users className="w-3 h-3" />
              <span>{activeSpeakers.length}</span>
            </div>
          )}

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
            <div className="glass rounded-2xl p-6">
              <h2 className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-5">
                {strings.meeting.consensus}
              </h2>
              <ConsensusGauge score={score} stale={stale} delta={scoreDelta} history={scoreHistory} />
            </div>

            <div className="glass rounded-2xl p-6">
              <h2 className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-4">
                {strings.meeting.bridge}
              </h2>
              <BridgeNotes events={events} />
            </div>

            {speakerId && (
              <LiveInput meetingId={initialSnapshot.meeting_id} speakerId={speakerId} autoListen={!!speakerId} />
            )}
          </div>

          {/* Right column */}
          <div className="col-span-12 lg:col-span-8 space-y-5">
            {speakerId && (
              <VideoCall meetingId={initialSnapshot.meeting_id} peerId={speakerId} onJoinedChange={() => {}} />
            )}

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
                <div className="ml-auto flex items-center px-4 text-xs text-slate-600 tabular-nums">
                  {events.filter((e) => e.type === "utterance").length} utterances
                </div>
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
