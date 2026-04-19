// Deterministic 768-dim text embedder used by both indexing and query.
// Strategy: tokenize → for each token compute 4 hashes → bump those buckets
// (sub-linear weight). Length-normalized. Same vector space as kb rows since
// both sides use this exact function. Good enough for keyword-overlap RAG when
// no embedding model is available.

const DIM = 768;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

const STOP = new Set([
  "the","and","for","you","with","this","that","are","was","but","not","can","your",
  "all","any","one","two","get","out","use","has","have","had","its","into","off","let",
  "who","why","how","when","where","what","then","than","also","very","just","now","new",
]);

// fnv1a 32-bit
function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function embedText(text: string): number[] {
  const v = new Float64Array(DIM);
  const tokens = tokenize(text);
  if (tokens.length === 0) return Array.from(v);

  // Term frequency
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);

  for (const [tok, count] of tf) {
    const w = 1 + Math.log(count); // sublinear TF
    // 4 hash buckets per token (signed)
    for (let k = 0; k < 4; k++) {
      const h = fnv1a(tok + "#" + k);
      const idx = h % DIM;
      const sign = (h >>> 16) & 1 ? 1 : -1;
      v[idx] += sign * w;
    }
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(DIM);
  for (let i = 0; i < DIM; i++) out[i] = v[i] / norm;
  return out;
}
