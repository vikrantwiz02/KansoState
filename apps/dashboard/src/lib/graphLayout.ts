export interface GraphAnalysis {
  // Index of the topic cluster each node belongs to (0..k-1).
  clusterId: number[];
  // Whether the node bridges into a different cluster (a topic pivot).
  isPivot: boolean[];
}

// Group utterances into tight topic clusters (union-find at a high similarity
// threshold), then flag pivots: nodes that link out to a *different* cluster at
// a looser threshold. Cluster membership and bridge detection use separate
// thresholds on purpose — otherwise the bridging link would merge the two
// clusters and there'd be nothing left to detect.
export function analyzeClusters(
  n: number,
  similarity: number[][],
  clusterThreshold = 0.5,
  pivotThreshold = 0.42,
): GraphAnalysis {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if ((similarity[i]?.[j] ?? 0) >= clusterThreshold) union(i, j);
    }
  }

  const rootToId = new Map<number, number>();
  const clusterId = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!rootToId.has(r)) rootToId.set(r, rootToId.size);
    clusterId[i] = rootToId.get(r)!;
  }

  const isPivot = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if ((similarity[i]?.[j] ?? 0) >= pivotThreshold && clusterId[j] !== clusterId[i]) {
        isPivot[i] = true;
        break;
      }
    }
  }

  return { clusterId, isPivot };
}

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','am','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall',
  'can','i','you','he','she','it','we','they','my','your','his','her',
  'its','our','their','that','this','these','those','so','if','by',
  'from','not','as','what','how','when','where','who','which','about',
  'me','just','then','than','up','out','into','also','there','here',
  'very','really','like','now','only','even','both','each','s','t',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

export function computeSimilarityMatrix(texts: string[]): number[][] {
  const n = texts.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  if (n === 0) return matrix;

  const tokenized = texts.map(tokenize);

  const tfs = tokenized.map(tokens => {
    const freq = new Map<string, number>();
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
    const total = tokens.length || 1;
    const result = new Map<string, number>();
    for (const [t, count] of freq) result.set(t, count / total);
    return result;
  });

  const df = new Map<string, number>();
  for (const tokens of tokenized) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const vectors = tfs.map(tfMap => {
    const vec = new Map<string, number>();
    for (const [t, tfVal] of tfMap) {
      const idf = Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;
      vec.set(t, tfVal * idf);
    }
    return vec;
  });

  function cosine(a: Map<string, number>, b: Map<string, number>): number {
    let dot = 0, normA = 0, normB = 0;
    for (const [t, v] of a) {
      dot += v * (b.get(t) ?? 0);
      normA += v * v;
    }
    for (const [, v] of b) normB += v * v;
    if (normA === 0 || normB === 0) return 0;
    return Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB)));
  }

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      if (tokenized[i].length === 0 || tokenized[j].length === 0) continue;
      const sim = cosine(vectors[i], vectors[j]);
      matrix[i][j] = sim;
      matrix[j][i] = sim;
    }
  }

  return matrix;
}

// Fruchterman-Reingold force-directed layout.
// Similar utterances attract; all utterances repel. Deterministic (circular init).
// After all iterations the centroid is re-anchored to the canvas center so the
// default React Flow viewport (origin = top-left) shows nodes roughly centered,
// and fitView only has to do a small correction rather than a large pan.
export function forceLayout(
  n: number,
  similarity: number[][],
  width = 800,
  height = 450,
  iterations = 80,
): { x: number; y: number }[] {
  if (n === 0) return [];
  if (n === 1) return [{ x: width / 2, y: height / 2 }];

  const EDGE_THRESHOLD = 0.3;
  // Nodes are ~200px wide and ~60px tall; keep them at least this far apart.
  const MIN_SEP = 70;

  const pos = Array.from({ length: n }, (_, i) => ({
    x: width / 2 + (width * 0.35) * Math.cos((2 * Math.PI * i) / n),
    y: height / 2 + (height * 0.35) * Math.sin((2 * Math.PI * i) / n),
  }));

  const k = Math.sqrt((width * height) / n);

  for (let iter = 0; iter < iterations; iter++) {
    const temp = k * 2 * (1 - iter / iterations);
    const disp = Array.from({ length: n }, () => ({ x: 0, y: 0 }));

    // Repulsion — floor distance at MIN_SEP so identical nodes can't collapse.
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_SEP);
        const f = (k * k) / dist;
        disp[i].x += (dx / dist) * f;
        disp[i].y += (dy / dist) * f;
      }
    }

    // Attraction — only between utterances that share topic; stop pulling once
    // closer than MIN_SEP so they don't overlap after repulsion does its job.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sim = similarity[i]?.[j] ?? 0;
        if (sim < EDGE_THRESHOLD) continue;
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIN_SEP) continue;
        const f = (dist * dist / k) * sim;
        disp[i].x += (dx / dist) * f;
        disp[i].y += (dy / dist) * f;
        disp[j].x -= (dx / dist) * f;
        disp[j].y -= (dy / dist) * f;
      }
    }

    // Apply displacement with cooling — no per-iteration hard clamp so the
    // centroid doesn't drift into a corner.
    for (let i = 0; i < n; i++) {
      const len = Math.max(Math.sqrt(disp[i].x ** 2 + disp[i].y ** 2), 0.01);
      const move = Math.min(len, temp);
      pos[i].x += (disp[i].x / len) * move;
      pos[i].y += (disp[i].y / len) * move;
    }
  }

  // Re-anchor centroid to canvas centre, then soft-clamp with margin.
  const avgX = pos.reduce((s, p) => s + p.x, 0) / n;
  const avgY = pos.reduce((s, p) => s + p.y, 0) / n;
  const margin = 120;
  for (const p of pos) {
    p.x = Math.max(margin, Math.min(width - margin, p.x - avgX + width / 2));
    p.y = Math.max(margin, Math.min(height - margin, p.y - avgY + height / 2));
  }

  return pos;
}
