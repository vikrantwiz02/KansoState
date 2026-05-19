import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

// The browser-facing WebSocket URL (what the user's browser dials, not the internal Docker URL).
const SENTINEL_WS_URL = process.env.SENTINEL_WS_URL ?? "ws://localhost:8080";
const SENTINEL_API_KEY = process.env.SENTINEL_API_KEY ?? "";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const meetingId = searchParams.get("meetingId");
  if (!meetingId) return NextResponse.json({ error: "meetingId required" }, { status: 400 });

  const tokenParam = SENTINEL_API_KEY ? `&token=${encodeURIComponent(SENTINEL_API_KEY)}` : "";
  const url = `${SENTINEL_WS_URL}/ws?meetingId=${encodeURIComponent(meetingId)}${tokenParam}`;

  return NextResponse.json({ url });
}
