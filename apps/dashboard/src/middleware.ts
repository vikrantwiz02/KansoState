import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/meetings"];

const SENTINEL_URL = process.env.SENTINEL_URL ?? "http://localhost:8080";
// SENTINEL_PUBLIC_URL is the browser-reachable sentinel origin used in CSP connect-src.
// Defaults to SENTINEL_URL so local dev works without extra config.
const SENTINEL_PUBLIC_URL =
  process.env.SENTINEL_PUBLIC_URL ?? SENTINEL_URL;

function sentinelWsOrigin(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.origin;
  } catch {
    return "ws://localhost:8080";
  }
}

function buildCsp(): string {
  const httpOrigin = SENTINEL_PUBLIC_URL.replace(/\/$/, "");
  const wsOrigin = sentinelWsOrigin(SENTINEL_PUBLIC_URL);
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${httpOrigin} ${wsOrigin}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const token = await getToken({ req });
    if (!token) {
      const signIn = new URL("/auth/signin", req.url);
      signIn.searchParams.set("callbackUrl", req.url);
      return NextResponse.redirect(signIn);
    }
  }

  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", buildCsp());
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
