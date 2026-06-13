"use client";

import { memo } from "react";
import { BaseEdge, getStraightPath } from "reactflow";
import type { SemanticEdgeData } from "@/lib/types";

interface Props {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  data?: SemanticEdgeData;
}

function SemanticEdgeComponent({ id, sourceX, sourceY, targetX, targetY, data }: Props) {
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const similarity = data?.similarity ?? 0.5;
  const opacity = 0.3 + similarity * 0.7;
  // Thickness reinforces similarity; bridge edges (cross-cluster links) glow cyan
  // so the pivot connections stand out from same-topic links.
  const strokeWidth = 1 + similarity * 2.5;
  const stroke = data?.bridge ? "#22d3ee" : "#3b82f6";

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ stroke, opacity, strokeWidth }} />
    </>
  );
}

export const SemanticEdge = memo(SemanticEdgeComponent);
