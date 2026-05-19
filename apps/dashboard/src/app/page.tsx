import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ArrowRight, Activity, Shield, Zap, GitBranch, Timer, RefreshCcw } from "lucide-react";

export default async function LandingPage() {
  const session = await getServerSession(authOptions);

  const features = [
    {
      icon: Activity,
      title: "Live consensus score",
      body: "A 0–1 score measuring semantic alignment across all speakers, recalculated after every utterance.",
      color: "from-indigo-500/20 to-indigo-500/5",
      iconColor: "text-indigo-400",
      border: "border-indigo-500/20",
    },
    {
      icon: Timer,
      title: "Speaker timeline",
      body: "Per-speaker scrollable strip showing who said what and when. Spot monologues instantly.",
      color: "from-violet-500/20 to-violet-500/5",
      iconColor: "text-violet-400",
      border: "border-violet-500/20",
    },
    {
      icon: GitBranch,
      title: "Intent graph",
      body: "Utterances as a live force graph — semantic edges reveal topic clusters forming and fracturing in real time.",
      color: "from-cyan-500/20 to-cyan-500/5",
      iconColor: "text-cyan-400",
      border: "border-cyan-500/20",
    },
    {
      icon: Zap,
      title: "Bridge notes",
      body: "Automatic context notes fire the moment alignment diverges, converges, or a speaker drifts off-topic.",
      color: "from-amber-500/20 to-amber-500/5",
      iconColor: "text-amber-400",
      border: "border-amber-500/20",
    },
    {
      icon: Shield,
      title: "PII redaction",
      body: "Names, emails, phone numbers, and card numbers are stripped before any data leaves the ingestion layer.",
      color: "from-emerald-500/20 to-emerald-500/5",
      iconColor: "text-emerald-400",
      border: "border-emerald-500/20",
    },
    {
      icon: RefreshCcw,
      title: "Crash-safe WAL",
      body: "Write-ahead log ensures zero utterance loss on crash. Replays automatically on the next boot.",
      color: "from-rose-500/20 to-rose-500/5",
      iconColor: "text-rose-400",
      border: "border-rose-500/20",
    },
  ];

  return (
    <div className="min-h-screen bg-[#070810] text-slate-100 overflow-x-hidden">
      {/* Ambient orbs */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="orb-a absolute top-[-100px] left-[-80px] w-[700px] h-[700px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(99,102,241,0.55) 0%, transparent 65%)", filter: "blur(90px)" }}
        />
        <div
          className="orb-b absolute top-[40%] right-[-100px] w-[550px] h-[550px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.45) 0%, transparent 65%)", filter: "blur(90px)" }}
        />
        <div
          className="orb-a absolute bottom-[50px] left-[35%] w-[500px] h-[500px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(8,145,178,0.35) 0%, transparent 65%)", filter: "blur(80px)" }}
        />
      </div>

      {/* Dot grid */}
      <div className="fixed inset-0 dot-grid opacity-100 pointer-events-none" />

      {/* Nav */}
      <nav className="relative z-10 flex justify-between items-center px-8 py-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-xs font-bold">
            K
          </div>
          <span className="font-semibold text-base tracking-tight">KansoState</span>
        </div>
        <div className="flex items-center gap-3">
          {session ? (
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium transition-colors"
            >
              Dashboard <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <>
              <Link href="/auth/signin" className="text-sm text-slate-400 hover:text-slate-200 transition-colors px-3 py-2">
                Sign in
              </Link>
              <Link
                href="/auth/signin"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium transition-colors"
              >
                Get started <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-5xl mx-auto px-8 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-medium tracking-wide mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 pulse-live" />
          Real-time · Private · Zero-latency
        </div>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] mb-6">
          Know where your meeting{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, #818cf8, #c084fc, #38bdf8)" }}
          >
            stands right now.
          </span>
        </h1>

        <p className="text-lg text-slate-400 leading-relaxed max-w-2xl mx-auto mb-10">
          KansoState measures semantic alignment across every speaker in real time,
          redacts PII on the wire, and surfaces the exact moment consensus shifts —
          before anyone leaves confused.
        </p>

        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/auth/signin"
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-base font-semibold transition-all hover:shadow-[0_0_30px_rgba(99,102,241,0.4)]"
          >
            Start for free <ArrowRight className="w-4 h-4" />
          </Link>
          <a
            href="#features"
            className="flex items-center gap-2 px-6 py-3 rounded-xl border border-white/10 hover:border-white/20 text-base font-medium text-slate-300 hover:text-white transition-all"
          >
            See how it works
          </a>
        </div>
      </section>

      {/* Live preview card */}
      <section className="relative z-10 max-w-4xl mx-auto px-8 pb-24">
        <div className="glass rounded-2xl overflow-hidden glow-indigo">
          {/* Fake window chrome */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/60" />
              <div className="w-3 h-3 rounded-full bg-amber-500/60" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/60" />
            </div>
            <div className="flex-1 flex justify-center">
              <div className="flex items-center gap-2 px-3 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-xs text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-live" />
                meeting · sprint-planning-may · live
              </div>
            </div>
          </div>
          {/* Fake dashboard preview */}
          <div className="p-6 grid grid-cols-3 gap-4">
            {/* Score */}
            <div className="col-span-1 rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-3">Consensus</div>
              <div className="flex flex-col items-center">
                <div className="text-4xl font-mono font-bold text-indigo-400">0.74</div>
                <div className="mt-2 w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: "74%" }} />
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-emerald-400 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  High alignment
                </div>
              </div>
            </div>
            {/* Timeline */}
            <div className="col-span-2 rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-3">Speaker timeline</div>
              <div className="space-y-2">
                {[
                  { name: "alice", text: "Auth refactor is top priority given the audit.", color: "#818cf8" },
                  { name: "bob", text: "Two sprints is realistic if we drop legacy SSO.", color: "#a78bfa" },
                  { name: "carol", text: "Analytics dependency is blocking two teams.", color: "#38bdf8" },
                ].map(({ name, text, color }) => (
                  <div key={name} className="flex gap-2.5 items-start">
                    <div className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                    <div>
                      <span className="text-xs font-medium" style={{ color }}>{name}</span>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Bridge note */}
            <div className="col-span-3 rounded-xl bg-indigo-500/[0.06] border border-indigo-500/20 p-4 flex gap-3 items-start">
              <Zap className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-medium text-indigo-300">Bridge note · high-alignment</span>
                <p className="text-sm text-slate-300 mt-1">Strong semantic alignment across speakers — a good moment to record decisions.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 max-w-5xl mx-auto px-8 pb-24">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold tracking-tight mb-3">
            Everything you need to run sharper meetings
          </h2>
          <p className="text-slate-400 text-base">
            Built on a real-time embeddings pipeline — not keyword matching.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(({ icon: Icon, title, body, color, iconColor, border }) => (
            <div
              key={title}
              className={`glass rounded-xl p-5 hover:border-white/[0.14] transition-all hover:translate-y-[-2px] ${border}`}
            >
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center mb-4`}>
                <Icon className={`w-4.5 h-4.5 ${iconColor}`} size={18} />
              </div>
              <h3 className="font-semibold text-sm mb-2 text-slate-100">{title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 max-w-3xl mx-auto px-8 pb-24 text-center">
        <div className="glass rounded-2xl p-12 border-indigo-500/20 glow-indigo">
          <h2 className="text-3xl font-bold tracking-tight mb-3">
            Ready for your next meeting?
          </h2>
          <p className="text-slate-400 mb-8">
            Sign in with Google — no credit card, no setup, no friction.
          </p>
          <Link
            href="/auth/signin"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-base font-semibold transition-all hover:shadow-[0_0_30px_rgba(99,102,241,0.5)]"
          >
            Sign in with Google <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.06] py-6 text-center text-xs text-slate-600">
        © {new Date().getFullYear()} KansoState
      </footer>
    </div>
  );
}
