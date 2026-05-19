"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getStraightPath } from "reactflow";
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
  const [edgePath, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const opacity = data ? 0.3 + data.similarity * 0.7 : 0.5;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ stroke: "#3b82f6", opacity }} />
    </>
  );
}

export const SemanticEdge = memo(SemanticEdgeComponent);
