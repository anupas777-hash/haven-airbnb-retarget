export type Sentiment = { label: 'positive' | 'neutral' | 'negative'; score: number }; // score -1..1

// lightweight lexicon-based analyzer, no external key required
const POSITIVE = new Set(['love','loved','loves','great','awesome','excellent','amazing','wonderful','fantastic','good','best','happy','satisfied','perfect','nice','enjoy','enjoyed','pleased','delighted','thank','thanks','helpful','friendly','clean','fast','quick','easy','recommend','recommended','absolutely']);
const NEGATIVE = new Set(['hate','terrible','awful','horrible','bad','worst','disappointed','poor','sad','angry','upset','rude','slow','dirty','expensive','overpriced','broken','wait','waiting','never','not','no','complaint','issue','problem','disgusting','annoying']);

const NEGATIONS = new Set(['not','no','never','hardly','barely','nothing','nowhere','neither','nor','none']);

export function analyzeSentiment(comment: string | null | undefined): Sentiment {
  if (!comment || !comment.trim()) return { label: 'neutral', score: 0 };
  const tokens = comment.toLowerCase().replace(/[^a-z0-9\s']/g,' ').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { label: 'neutral', score: 0 };
  let score = 0;
  let negated = false;
  for (let i=0;i<tokens.length;i++) {
    const tok = tokens[i];
    if (NEGATIONS.has(tok)) { negated = true; continue; }
    if (POSITIVE.has(tok)) {
      score += negated ? -1 : 1;
      negated = false;
    } else if (NEGATIVE.has(tok)) {
      // 'not' already counts as negative token? handle specially: "not bad" -> positive
      if (tok === 'not' || tok === 'no' || tok === 'never') {
        // already handled as negation flag; but if isolated, penalize slightly
        continue;
      }
      score += negated ? 1 : -1;
      negated = false;
    } else {
      // reset negation if too far?
      if (negated && i>0 && tokens[i-1] && !POSITIVE.has(tokens[i-1]) && !NEGATIVE.has(tokens[i-1])) {
        // keep negated for next token only
      }
    }
    // negation scope lasts one sentiment word
  }
  // normalize -1..1
  const normalized = Math.max(-1, Math.min(1, score / Math.max(3, tokens.length * 0.3)));
  let label: Sentiment['label'] = 'neutral';
  if (normalized > 0.2) label = 'positive';
  else if (normalized < -0.2) label = 'negative';
  return { label, score: Number(normalized.toFixed(3)) };
}

export function hashComment(comment: string): string {
  // simple deterministic hash (djb2)
  let hash = 5381;
  for (let i=0;i<comment.length;i++) hash = ((hash << 5) + hash) + comment.charCodeAt(i);
  return (hash >>> 0).toString(16);
}
