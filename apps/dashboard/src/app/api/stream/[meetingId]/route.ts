import { NextRequest } from "next/server";

const SENTINEL_URL = process.env.SENTINEL_URL ?? "http://localhost:8080";
const SENTINEL_API_KEY = process.env.SENTINEL_API_KEY ?? "";

// SSE relay: proxies the sentinel SSE stream to the browser.
// Handles Last-Event-Id for resumption; 60-second ring buffer is in Go.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const { meetingId } = await params;
  const lastEventId = req.headers.get("last-event-id") ?? "";

  const upstreamUrl = new URL(`${SENTINEL_URL}/sse`);
  upstreamUrl.searchParams.set("meetingId", meetingId);

  const upstreamReq = new Request(upstreamUrl.toString(), {
    headers: {
      ...(lastEventId && { "Last-Event-Id": lastEventId }),
      ...(SENTINEL_API_KEY && { "X-Sentinel-Key": SENTINEL_API_KEY }),
    },
    signal: req.signal,
  });

  try {
    const upstreamRes = await fetch(upstreamReq);
    if (!upstreamRes.ok || !upstreamRes.body) {
      return new Response("upstream unavailable", { status: 502 });
    }

    return new Response(upstreamRes.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return new Response("stream error", { status: 502 });
  }
}
