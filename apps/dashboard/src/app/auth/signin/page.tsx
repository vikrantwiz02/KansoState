import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { SignInButton } from "./SignInButton";
import Link from "next/link";

export default async function SignInPage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-[#070810] flex items-center justify-center px-4 overflow-hidden">
      {/* Ambient orbs */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="orb-a absolute top-[-80px] left-[5%] w-[600px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(99,102,241,0.6) 0%, transparent 65%)", filter: "blur(90px)" }}
        />
        <div
          className="orb-b absolute bottom-[-80px] right-[5%] w-[500px] h-[500px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(124,58,237,0.5) 0%, transparent 65%)", filter: "blur(90px)" }}
        />
      </div>
      <div className="fixed inset-0 dot-grid pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-xl font-bold shadow-[0_0_30px_rgba(99,102,241,0.5)] mb-4">
            K
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">KansoState</h1>
          <p className="text-sm text-slate-400 mt-1">Real-time meeting intelligence</p>
        </div>

        {/* Card */}
        <div className="glass rounded-2xl p-8 glow-indigo">
          <p className="text-sm text-slate-400 text-center mb-6">
            Sign in to access your meeting dashboard
          </p>
          <SignInButton />
          <p className="text-xs text-slate-600 text-center mt-5">
            By signing in you agree to keep your meetings private.
          </p>
        </div>

        <div className="mt-5 text-center">
          <Link href="/" className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
