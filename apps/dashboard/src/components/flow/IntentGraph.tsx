"use client";

import { useEffect, useRef } from "react";
import ReactFlow, {
  Background,
  Controls,
  type NodeTypes,
  type EdgeTypes,
  type ReactFlowInstance,
} from "reactflow";
import type { UtteranceNodeData, SemanticEdgeData, SSEEnvelope, UtterancePayload, ConsensusEvent } from "@/lib/types";
import { UtteranceNode } from "./UtteranceNode";
import { SemanticEdge } from "./SemanticEdge";
import { GitBranch } from "lucide-react";

interface Props {
  events: SSEEnvelope[];
}

const nodeTypes: NodeTypes = { utterance: UtteranceNode };
const edgeTypes: EdgeTypes = { semantic: SemanticEdge };

export function IntentGraph({ events }: Props) {
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const utterances = events
    .filter((e) => e.type === "utterance")
    .map((e) => e.payload as UtterancePayload);

  const consensusMap = Object.fromEntries(
    events
      .filter((e) => e.type === "consensus")
      .map((e) => {
        const c = e.payload as ConsensusEvent;
        return [c.speaker_id, c.score];
      })
  );

  // Re-fit whenever the number of nodes changes so new utterances stay visible.
  // Must be before any early return to satisfy rules-of-hooks.
  useEffect(() => {
    if (rfRef.current && utterances.length > 0) {
      setTimeout(() => rfRef.current?.fitView({ padding: 0.25, duration: 300 }), 50);
    }
  }, [utterances.length]);

  if (utterances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[480px] text-center">
        <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-3">
          <GitBranch className="w-4 h-4 text-slate-600" />
        </div>
        <p className="text-xs text-slate-600">Graph will form as utterances arrive.</p>
      </div>
    );
  }

  const nodes = utterances.map((u, i) => ({
    id: `u-${u.seq}`,
    type: "utterance" as const,
    position: { x: (i % 4) * 240, y: Math.floor(i / 4) * 110 },
    data: {
      id: `u-${u.seq}`,
      speakerId: u.speaker_id,
      text: u.redacted_text,
      seq: u.seq,
      consensus: consensusMap[u.speaker_id] ?? 0,
    } satisfies UtteranceNodeData,
  }));

  const edges = utterances.slice(1).map((u, i) => ({
    id: `e-${i}`,
    source: `u-${utterances[i].seq}`,
    target: `u-${u.seq}`,
    type: "semantic" as const,
    data: {
      source: `u-${utterances[i].seq}`,
      target: `u-${u.seq}`,
      similarity: 0.5,
    } satisfies SemanticEdgeData,
  }));

  return (
    <div className="h-[480px] rounded-xl overflow-hidden border border-white/[0.06]" style={{ background: "rgba(0,0,0,0.3)" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(instance) => { rfRef.current = instance; }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgba(255,255,255,0.04)" gap={24} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
