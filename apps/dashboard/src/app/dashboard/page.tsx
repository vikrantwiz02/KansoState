import { listMeetings } from "@/lib/sentinel";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { Activity, ChevronRight, Radio, Clock, LogOut } from "lucide-react";
import { StartMeetingButton } from "@/components/StartMeetingButton";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const meetings = await listMeetings();

  const initials = session?.user?.name
    ? session.user.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  return (
    <div className="min-h-screen bg-[#070810] text-slate-100">
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="orb-a absolute top-[-120px] right-[5%] w-[600px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(99,102,241,0.5) 0%, transparent 65%)", filter: "blur(90px)" }}
        />
        <div
          className="orb-b absolute bottom-[-80px] left-[10%] w-[450px] h-[450px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.35) 0%, transparent 65%)", filter: "blur(80px)" }}
        />
      </div>
      <div className="fixed inset-0 dot-grid pointer-events-none" />

      {/* Nav */}
      <nav className="relative z-10 flex justify-between items-center px-8 py-4 border-b border-white/[0.06]">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-xs font-bold">
            K
          </div>
          <span className="font-semibold text-sm tracking-tight">KansoState</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[10px] font-bold">
              {initials}
            </div>
            <span className="text-xs text-slate-400 max-w-[140px] truncate">
              {session?.user?.email}
            </span>
          </div>
          <Link
            href="/api/auth/signout"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-all"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </Link>
        </div>
      </nav>

      {/* Content */}
      <div className="relative z-10 max-w-3xl mx-auto px-8 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Meetings</h1>
            <p className="text-sm text-slate-500 mt-1">
              {meetings.length === 0
                ? "No active meetings"
                : `${meetings.length} meeting${meetings.length !== 1 ? "s" : ""} in the ring buffer`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {meetings.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-live" />
                Live data
              </div>
            )}
            <StartMeetingButton />
          </div>
        </div>

        {meetings.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto mb-4">
              <Activity className="w-6 h-6 text-slate-600" />
            </div>
            <h3 className="font-semibold text-slate-300 mb-2">No active meetings</h3>
            <p className="text-sm text-slate-500 max-w-xs mx-auto mb-6 leading-relaxed">
              Connect a client to the WebSocket endpoint to start ingesting meeting data.
            </p>
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs font-mono text-slate-400">
              ws://localhost:8080/ws?meetingId=
              <span className="text-indigo-400">&lt;id&gt;</span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {meetings.map((m) => (
              <Link
                key={m.id}
                href={`/meetings/${m.id}`}
                className="group flex items-center justify-between glass rounded-xl px-5 py-4 hover:border-indigo-500/30 hover:bg-indigo-500/[0.04] transition-all"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      m.state === "live"
                        ? "bg-emerald-500/10 border border-emerald-500/20"
                        : "bg-white/[0.04] border border-white/[0.08]"
                    }`}
                  >
                    {m.state === "live" ? (
                      <Radio className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Clock className="w-4 h-4 text-slate-500" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-sm text-slate-100 group-hover:text-white transition-colors">
                      {m.title || m.id}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {m.state === "live" && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-live" />
                      )}
                      <span className={`text-xs ${m.state === "live" ? "text-emerald-400" : "text-slate-500"}`}>
                        {m.state}
                      </span>
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-300 group-hover:translate-x-0.5 transition-all" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
