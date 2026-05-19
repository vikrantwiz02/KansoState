import type { MeetingSnapshot } from "./types";

const SENTINEL_URL = process.env.SENTINEL_URL ?? "http://localhost:8080";
const SENTINEL_API_KEY = process.env.SENTINEL_API_KEY ?? "";

function sentinelHeaders(): HeadersInit {
  return SENTINEL_API_KEY ? { "X-Sentinel-Key": SENTINEL_API_KEY } : {};
}

export async function hydrateMeeting(meetingId: string): Promise<MeetingSnapshot> {
  const res = await fetch(
    `${SENTINEL_URL}/api/v1/meetings/${encodeURIComponent(meetingId)}/hydrate`,
    {
      next: { revalidate: 0 },
      headers: sentinelHeaders(),
      signal: AbortSignal.timeout(3000),
    }
  );
  if (!res.ok) {
    throw new Error(`hydrate ${meetingId}: ${res.status}`);
  }
  return res.json();
}

export async function listMeetings(): Promise<{ id: string; title: string; state: string }[]> {
  const res = await fetch(`${SENTINEL_URL}/api/v1/meetings`, {
    cache: "no-store",
    headers: sentinelHeaders(),
    signal: AbortSignal.timeout(3000),
  }).catch(() => null);
  if (!res?.ok) return [];
  return res.json();
}
