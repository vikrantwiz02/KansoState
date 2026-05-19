import type { NextConfig } from "next";

const SENTINEL_URL = process.env.SENTINEL_URL ?? "http://localhost:8080";

// Derive ws/wss origin from SENTINEL_URL for the CSP connect-src directive.
function sentinelWsOrigin(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.origin;
  } catch {
    return "ws://localhost:8080";
  }
}

const wsOrigin = sentinelWsOrigin(SENTINEL_URL);
const httpOrigin = SENTINEL_URL.replace(/\/$/, "");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // Next.js inline scripts
      "style-src 'self' 'unsafe-inline'",  // inline styles used throughout
      `connect-src 'self' ${httpOrigin} ${wsOrigin}`,
      "img-src 'self' data:",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const config: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default config;
