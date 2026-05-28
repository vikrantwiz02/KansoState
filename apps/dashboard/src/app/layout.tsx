import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const BASE_URL = "https://kansostate.vikrantkumar.site";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "KansoState — Real-time meeting intelligence",
    template: "%s | KansoState",
  },
  description:
    "KansoState measures semantic alignment across every speaker in real time. Live consensus scoring, speaker timeline, intent graph, and PII redaction — know where your meeting stands as it happens.",
  keywords: [
    "real-time meeting intelligence",
    "meeting consensus score",
    "live meeting analytics",
    "semantic alignment",
    "speaker timeline",
    "PII redaction meetings",
    "meeting insights tool",
    "remote meeting analytics",
    "AI meeting assistant",
    "meeting alignment tracker",
  ],
  authors: [{ name: "KansoState", url: BASE_URL }],
  creator: "KansoState",
  alternates: {
    canonical: BASE_URL,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: BASE_URL,
    siteName: "KansoState",
    title: "KansoState — Real-time meeting intelligence",
    description:
      "Know where your meeting stands, as it happens. Live consensus scoring, speaker timeline, and PII redaction.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "KansoState — Real-time meeting intelligence dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "KansoState — Real-time meeting intelligence",
    description:
      "Know where your meeting stands, as it happens. Live consensus scoring, speaker timeline, and PII redaction.",
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  category: "technology",
  verification: {
    google: "371WgyTVeiHLIM2qjaWCF0jT86KKk7tiq4S2vbJe-dw",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
