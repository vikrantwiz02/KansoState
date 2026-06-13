"use client";

import { memo } from "react";
import { Handle, Position } from "reactflow";
import type { UtteranceNodeData } from "@/lib/types";
import { consensusColor, nodeRing } from "@/lib/graphColors";

interface Props {
  data: UtteranceNodeData;
}

function UtteranceNodeComponent({ data }: Props) {
  const { bg, border } = consensusColor(data.consensus);
  const ring = nodeRing(data.isPivot, data.isFracture);

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        padding: "8px 12px",
        maxWidth: 200,
        fontSize: "0.75rem",
        boxShadow: ring,
        transition: "box-shadow 200ms ease, background 200ms ease",
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ color: "#94a3b8" }}>{data.speakerId}</span>
        {data.isPivot && (
          <span style={{ color: "#22d3ee", fontSize: "0.6rem", letterSpacing: "0.04em" }}>
            PIVOT
          </span>
        )}
        {data.isFracture && (
          <span style={{ color: "#f97316", fontSize: "0.6rem", letterSpacing: "0.04em" }}>
            DRIFT
          </span>
        )}
      </div>
      <div style={{ color: "#e2e8f0", lineHeight: 1.4 }}>
        {data.text.length > 60 ? data.text.slice(0, 57) + "…" : data.text}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const UtteranceNode = memo(UtteranceNodeComponent);
