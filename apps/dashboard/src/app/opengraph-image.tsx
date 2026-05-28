import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "KansoState — Real-time meeting intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#070810",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
        }}
      >
        {/* Background glow */}
        <div
          style={{
            position: "absolute",
            top: -100,
            left: -80,
            width: 700,
            height: 700,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(99,102,241,0.45) 0%, transparent 65%)",
            filter: "blur(80px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -80,
            right: -80,
            width: 550,
            height: 550,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(139,92,246,0.4) 0%, transparent 65%)",
            filter: "blur(80px)",
          }}
        />

        {/* Logo */}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: "linear-gradient(135deg, #6366f1, #7c3aed)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            fontWeight: 700,
            color: "#fff",
            marginBottom: 28,
          }}
        >
          K
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            color: "#f1f5f9",
            letterSpacing: "-2px",
            lineHeight: 1.05,
            textAlign: "center",
            maxWidth: 900,
            marginBottom: 20,
          }}
        >
          Real-time meeting intelligence
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 26,
            color: "#94a3b8",
            textAlign: "center",
            maxWidth: 700,
            lineHeight: 1.5,
            marginBottom: 40,
          }}
        >
          Live consensus scoring · Speaker timeline · PII redaction
        </div>

        {/* Pill badges */}
        <div style={{ display: "flex", gap: 12 }}>
          {["Semantic AI", "Zero-latency", "Privacy-first"].map((label) => (
            <div
              key={label}
              style={{
                padding: "8px 20px",
                borderRadius: 999,
                background: "rgba(99,102,241,0.15)",
                border: "1px solid rgba(99,102,241,0.3)",
                color: "#a5b4fc",
                fontSize: 18,
                fontWeight: 500,
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Domain */}
        <div
          style={{
            position: "absolute",
            bottom: 36,
            fontSize: 18,
            color: "#475569",
          }}
        >
          kansostate.vikrantkumar.site
        </div>
      </div>
    ),
    { ...size }
  );
}
