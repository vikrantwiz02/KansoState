export interface SSEEnvelope {
  type: "utterance" | "consensus" | "bridge" | "heartbeat" | "shutdown";
  meeting_id: string;
  payload: unknown;
  seq: number;
}

export interface ConsensusEvent {
  meeting_id: string;
  speaker_id: string;
  score: number;
  delta: number;
  drift: number;
  stale: boolean;
  seq: number;
}

export interface UtterancePayload {
  meeting_id: string;
  speaker_id: string;
  seq: number;
  redacted_text: string;
  vclock: Record<string, number>;
}

export interface BridgeNote {
  meeting_id: string;
  tags: string[];
  note: string;
  ts: string;
}

export interface MeetingSnapshot {
  meeting_id: string;
  events: SSEEnvelope[];
  vclock: Record<string, number>;
  consensus_score: number;
  stale: boolean;
}

export interface UtteranceNodeData {
  id: string;
  speakerId: string;
  text: string;
  seq: number;
  // Consensus score at the moment this utterance was spoken (matched by seq).
  consensus: number;
  // Speaker's drift from their own baseline at that moment.
  drift: number;
  // Bridges two otherwise-separate topic clusters.
  isPivot: boolean;
  // Drift spiked here — the speaker swung away from the conversation.
  isFracture: boolean;
}

export interface SemanticEdgeData {
  source: string;
  target: string;
  similarity: number;
  // True when the two endpoints live in different topic clusters.
  bridge?: boolean;
}
