import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "KansoState — Real-time meeting intelligence",
  description: "Know where your meeting stands, as it happens. Live consensus scoring, speaker timeline, PII redaction.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
