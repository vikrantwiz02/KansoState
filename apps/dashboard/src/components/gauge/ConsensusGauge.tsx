"use client";

interface Props {
  score: number;
  stale?: boolean;
}

const SIZE = 220;
const R = 88;
const CX = SIZE / 2;
const CY = SIZE / 2;
const START_ANGLE = -Math.PI;
const END_ANGLE = 0;

function polarToXY(angle: number, r: number) {
  return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
}

function arcPath(startAngle: number, endAngle: number, r: number) {
  const s = polarToXY(startAngle, r);
  const e = polarToXY(endAngle, r);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
}

function scoreLabel(n: number) {
  if (n > 0.6) return { label: "High alignment", color: "#34d399" };
  if (n > 0.2) return { label: "Converging", color: "#a3e635" };
  if (n > -0.2) return { label: "Forming", color: "#fbbf24" };
  if (n > -0.6) return { label: "Diverging", color: "#fb923c" };
  return { label: "Misaligned", color: "#f87171" };
}

export function ConsensusGauge({ score, stale }: Props) {
  const normalised = Math.max(-1, Math.min(1, score));
  const fraction = (normalised + 1) / 2;
  const needleAngle = START_ANGLE + fraction * (END_ANGLE - START_ANGLE);

  const needleTip = polarToXY(needleAngle, R - 12);
  const needleBase = polarToXY(needleAngle + Math.PI / 2, 7);
  const needleBase2 = polarToXY(needleAngle - Math.PI / 2, 7);

  const { label, color: scoreColor } = scoreLabel(normalised);

  // Gradient segments for the arc track
  const segColors = ["#f87171", "#fb923c", "#fbbf24", "#a3e635", "#34d399"];

  return (
    <div className="flex flex-col items-center">
      <div style={{ position: "relative", width: SIZE, height: SIZE / 2 + 30 }}>
        <svg width={SIZE} height={SIZE / 2 + 20} viewBox={`0 0 ${SIZE} ${SIZE / 2 + 10}`}>
          <defs>
            <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              {segColors.map((c, i) => (
                <stop key={i} offset={`${(i / (segColors.length - 1)) * 100}%`} stopColor={c} stopOpacity={stale ? 0.3 : 0.9} />
              ))}
            </linearGradient>
          </defs>
          {/* Background track */}
          <path
            d={arcPath(START_ANGLE, END_ANGLE, R)}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={18}
            strokeLinecap="round"
          />
          {/* Colored fill up to needle */}
          <path
            d={arcPath(START_ANGLE, needleAngle, R)}
            fill="none"
            stroke="url(#gaugeGrad)"
            strokeWidth={18}
            strokeLinecap="round"
          />
          {/* Needle glow */}
          <polygon
            points={`${needleTip.x},${needleTip.y} ${needleBase.x},${needleBase.y} ${needleBase2.x},${needleBase2.y}`}
            fill={stale ? "#64748b" : "#f1f5f9"}
            opacity={0.9}
          />
          {/* Hub */}
          <circle cx={CX} cy={CY} r={8} fill="#070810" stroke="rgba(255,255,255,0.15)" strokeWidth={2} />
          <circle cx={CX} cy={CY} r={3} fill={stale ? "#64748b" : scoreColor} />
        </svg>
      </div>

      {/* Score readout */}
      <div className="text-center -mt-2">
        <div
          className="text-4xl font-mono font-bold tracking-tight tabular-nums"
          style={{ color: stale ? "#64748b" : scoreColor }}
        >
          {normalised.toFixed(3)}
        </div>
        <div className="text-sm font-medium mt-1" style={{ color: stale ? "#64748b" : scoreColor }}>
          {stale ? "Stale estimate" : label}
        </div>
      </div>

      {/* Tick labels */}
      <div className="flex justify-between w-full mt-4 px-3">
        {["−1", "−0.5", "0", "+0.5", "+1"].map((t) => (
          <span key={t} className="text-[10px] text-slate-600 font-mono">{t}</span>
        ))}
      </div>
    </div>
  );
}
