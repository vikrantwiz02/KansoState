// Consensus topography: map a consensus score (~[-1, 1], but realistically
// clustered near 0..0.8 for live meetings) to a dark-theme background tint and a
// matching border. Low alignment reads red/orange, high alignment reads green.
export function consensusColor(score: number): { bg: string; border: string } {
  // Normalize the useful band [-0.2, 0.8] → [0, 1]; clamp the tails.
  const t = Math.max(0, Math.min(1, (score + 0.2) / 1.0));
  // Hue sweep: 0° red → 45° amber → 135° green.
  const hue = Math.round(t * 135);
  return {
    bg: `hsl(${hue} 38% 15%)`,
    border: `hsl(${hue} 65% 48%)`,
  };
}

// Pivot = utterance that bridges two otherwise-separate topic clusters.
export const PIVOT_RING = "#22d3ee"; // cyan
// Fracture = utterance where the speaker drifted hard from their own baseline.
export const FRACTURE_RING = "#f97316"; // orange

// Box-shadow rings stack without affecting layout. A node that is BOTH a pivot
// and a fracture gets the cyan core wrapped in an orange glow — the standout
// "this turn changed direction AND cost alignment" moment.
export function nodeRing(isPivot: boolean, isFracture: boolean): string | undefined {
  if (isPivot && isFracture) {
    return `0 0 0 2px ${PIVOT_RING}, 0 0 0 4px ${FRACTURE_RING}, 0 0 16px 3px rgba(249,115,22,0.5)`;
  }
  if (isFracture) {
    return `0 0 0 2px ${FRACTURE_RING}, 0 0 14px 3px rgba(249,115,22,0.5)`;
  }
  if (isPivot) {
    return `0 0 0 2px ${PIVOT_RING}, 0 0 12px 2px rgba(34,211,238,0.45)`;
  }
  return undefined;
}
