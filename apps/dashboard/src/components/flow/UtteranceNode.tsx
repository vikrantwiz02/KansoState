"use client";

import { memo } from "react";
import { Handle, Position } from "reactflow";
import type { UtteranceNodeData } from "@/lib/types";

interface Props {
  data: UtteranceNodeData;
}

function UtteranceNodeComponent({ data }: Props) {
  const scoreColor =
    data.consensus > 0.5 ? "#22c55e" : data.consensus > 0 ? "#84cc16" : "#f59e0b";

  return (
    <div
      style={{
        background: "#1e2d3d",
        border: `1px solid ${scoreColor}`,
        borderRadius: 6,
        padding: "8px 12px",
        maxWidth: 200,
        fontSize: "0.75rem",
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ color: "#94a3b8", marginBottom: 4 }}>{data.speakerId}</div>
      <div style={{ color: "#e2e8f0", lineHeight: 1.4 }}>
        {data.text.length > 60 ? data.text.slice(0, 57) + "…" : data.text}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const UtteranceNode = memo(UtteranceNodeComponent);
