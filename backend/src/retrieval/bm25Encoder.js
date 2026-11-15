// BM25 sparse encoder for the keyword half of hybrid search.
//
// Each chunk becomes a sparse vector {term id -> BM25 term weight}. Qdrant stores the
// vectors in an inverted index and multiplies in the IDF part itself (collection is
// created with `modifier: idf`), so IDF always reflects the documents currently stored.
// Queries are sent as sparse vectors with weight 1 per term.

const STOPWORDS = new Set(
  ('a an and are as at be been but by can could did do does for from had has have how i if in into is it its may me my no not of on or our '
    + 'she he should so such than that the their them then there these they this to was we were what when where which who whom why will with would you your')
    .split(' '),
);

const K1 = 1.2;
const B = 0.75;

/** Lowercase, split on anything that is not a letter or digit, drop stopwords, strip plural "s". */
export function tokenize(text) {
  const tokens = [];
  for (const raw of (text || '').toLowerCase().normalize('NFKD').split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    if (raw.length === 1 && !/\d/.test(raw)) continue;
    tokens.push(raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') && !raw.endsWith('us') && !raw.endsWith('is') ? raw.slice(0, -1) : raw);
  }
  return tokens;
}

/** FNV-1a hash -> unsigned 32-bit term id (no vocabulary file to keep in sync). */
export function termId(token) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const toSparse = (weights) => {
  const indices = [...weights.keys()].sort((a, b) => a - b);
  return { indices, values: indices.map((index) => weights.get(index)) };
};

export class Bm25Encoder {
  /** @param {{avgDocLength?: number}} options  expected average chunk length in tokens */
  constructor({ avgDocLength = 200 } = {}) {
    this.avgDocLength = avgDocLength;
  }

  /** Sparse vector for a stored chunk: saturated, length-normalised term frequency. */
  encodeDocument(text) {
    const tokens = tokenize(text);
    const counts = new Map();
    for (const token of tokens) counts.set(termId(token), (counts.get(termId(token)) || 0) + 1);
    const weights = new Map();
    for (const [id, tf] of counts) {
      weights.set(id, (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * tokens.length) / this.avgDocLength)));
    }
    return toSparse(weights);
  }

  /** Sparse vector for a query: each distinct term once. */
  encodeQuery(text) {
    const weights = new Map();
    for (const token of tokenize(text)) weights.set(termId(token), 1);
    return toSparse(weights);
  }
}
