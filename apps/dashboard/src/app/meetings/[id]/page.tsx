import { hydrateMeeting } from "@/lib/sentinel";
import { MeetingView } from "@/components/MeetingView";
import type { MeetingSnapshot } from "@/lib/types";

interface Props {
  params: Promise<{ id: string }>;
}

// Empty snapshot for brand-new meetings that have no data yet.
function emptySnapshot(meetingId: string): MeetingSnapshot {
  return { meeting_id: meetingId, events: [], vclock: {}, consensus_score: 0, stale: false };
}

export default async function MeetingPage({ params }: Props) {
  const { id } = await params;

  let snapshot: MeetingSnapshot;
  try {
    snapshot = await hydrateMeeting(id);
  } catch {
    // New meeting or expired — show the empty view so the user can start speaking.
    snapshot = emptySnapshot(id);
  }

  return <MeetingView initialSnapshot={snapshot} />;
}
