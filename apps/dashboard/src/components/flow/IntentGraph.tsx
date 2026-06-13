"use client";

import { useEffect, useRef, useMemo } from "react";
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
import { computeSimilarityMatrix, forceLayout, analyzeClusters } from "@/lib/graphLayout";

const EDGE_THRESHOLD = 0.35;
const DRIFT_FRACTURE = 0.6;

interface Props {
  events: SSEEnvelope[];
}

const nodeTypes: NodeTypes = { utterance: UtteranceNode };
const edgeTypes: EdgeTypes = { semantic: SemanticEdge };

export function IntentGraph({ events }: Props) {
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a ref to the latest events so the layout memo can read them without
  // making `events` a dependency (which would re-run the expensive layout on
  // every consensus update, not just on new utterances).
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const utteranceCount = events.filter(e => e.type === "utterance").length;

  useEffect(() => {
    if (utteranceCount === 0) return;
    if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
    fitTimerRef.current = setTimeout(() => {
      rfRef.current?.fitView({ padding: 0.25, duration: 300 });
      fitTimerRef.current = null;
    }, 500);
  }, [utteranceCount]);

  const { nodes, edges } = useMemo(() => {
    const currentEvents = eventsRef.current;

    const utterances = currentEvents
      .filter((e) => e.type === "utterance")
      .map((e) => e.payload as UtterancePayload);

    // The backend stamps each consensus event with the same seq as its utterance,
    // so this gives us the consensus/drift snapshot from the exact moment each
    // utterance landed — not just the speaker's latest score.
    const consensusBySeq = new Map<number, ConsensusEvent>();
    const latestBySpeaker: Record<string, ConsensusEvent> = {};
    for (const e of currentEvents) {
      if (e.type !== "consensus") continue;
      const c = e.payload as ConsensusEvent;
      consensusBySeq.set(c.seq, c);
      latestBySpeaker[c.speaker_id] = c;
    }

    const texts = utterances.map(u => u.redacted_text);
    const simMatrix = computeSimilarityMatrix(texts);
    const positions = forceLayout(utterances.length, simMatrix);
    const analysis = analyzeClusters(utterances.length, simMatrix);

    const nodes = utterances.map((u, i) => {
      const c = consensusBySeq.get(u.seq) ?? latestBySpeaker[u.speaker_id];
      const drift = c?.drift ?? 0;
      return {
        id: `u-${u.seq}`,
        type: "utterance" as const,
        position: positions[i] ?? { x: 0, y: 0 },
        data: {
          id: `u-${u.seq}`,
          speakerId: u.speaker_id,
          text: u.redacted_text,
          seq: u.seq,
          consensus: c?.score ?? 0,
          drift,
          isPivot: analysis.isPivot[i],
          isFracture: drift > DRIFT_FRACTURE,
        } satisfies UtteranceNodeData,
      };
    });

    const edgeList: {
      id: string;
      source: string;
      target: string;
      type: "semantic";
      data: SemanticEdgeData;
    }[] = [];

    for (let i = 0; i < utterances.length; i++) {
      for (let j = i + 1; j < utterances.length; j++) {
        const sim = simMatrix[i]?.[j] ?? 0;
        if (sim < EDGE_THRESHOLD) continue;
        edgeList.push({
          id: `e-${i}-${j}`,
          source: `u-${utterances[i].seq}`,
          target: `u-${utterances[j].seq}`,
          type: "semantic",
          data: {
            source: `u-${utterances[i].seq}`,
            target: `u-${utterances[j].seq}`,
            similarity: sim,
            bridge: analysis.clusterId[i] !== analysis.clusterId[j],
          },
        });
      }
    }

    return { nodes, edges: edgeList };
  // Layout only reruns when a new utterance arrives, not on every consensus tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utteranceCount]);

  if (utteranceCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[480px] text-center">
        <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-3">
          <GitBranch className="w-4 h-4 text-slate-600" />
        </div>
        <p className="text-xs text-slate-600">Graph will form as utterances arrive.</p>
      </div>
    );
  }

  return (
    <div className="relative h-[480px] rounded-xl overflow-hidden border border-white/[0.06]" style={{ background: "rgba(0,0,0,0.3)" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        onInit={(instance) => { rfRef.current = instance; }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgba(255,255,255,0.04)" gap={24} />
        <Controls />
      </ReactFlow>
      <GraphLegend />
    </div>
  );
}

function GraphLegend() {
  return (
    <div
      className="absolute top-3 left-3 z-10 rounded-lg px-3 py-2 text-[0.625rem] leading-relaxed pointer-events-none"
      style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="inline-block h-2 w-12 rounded"
          style={{ background: "linear-gradient(90deg, hsl(0 65% 48%), hsl(45 65% 48%), hsl(135 65% 48%))" }}
        />
        <span>low → high alignment</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ boxShadow: "0 0 0 2px #22d3ee" }} />
        <span>pivot (bridges topics)</span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="inline-block h-2 w-2 rounded-full" style={{ boxShadow: "0 0 0 2px #f97316" }} />
        <span>drift (alignment drop)</span>
      </div>
    </div>
  );
}
