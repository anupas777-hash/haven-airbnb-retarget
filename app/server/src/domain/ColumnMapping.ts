import type { ColumnMapping, LogicalField } from 'shared';

// synonym dictionaries (case/spacing/underscore-insensitive)
const SYNONYMS: Record<LogicalField, string[]> = {
  name: ['name','customer','full name','client','customer name','client name','fullname'],
  phone: ['phone','mobile','number','whatsapp','contact','phone number','mobile number','telephone','tel','cell'],
  acquired_at: ['acquired','signup','joined','first visit','created','date','acquired at','signup date','join date','created at','first_visit','acquired_at','signup_at','customer since','since'],
  rating: ['rating','stars','score','satisfaction','star rating','rate'],
  comment: ['comment','feedback','review','notes','message','remarks','opinion','testimonial'],
  opt_in_whatsapp: ['opt in','consent','whatsapp ok','subscribed','opt_in','optin','whatsapp','opt in whatsapp','whatsapp opt in','marketing consent','opt-in'],
  email: ['email','e-mail','mail','email address','e mail'],
  key_attributes: ['key attributes','key attributes of customer','attributes','host notes','judgment','judgement','host judgment','notes','key attribute'],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\s]+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
}

function normalizeForCompare(s: string): string {
  return normalizeHeader(s);
}

/**
 * Fuzzy-match headers → logical fields.
 * Returns mapping + confidence per field (0..1).
 * Strategy:
 *  - exact normalized match -> 1.0
 *  - synonym exact -> 0.95
 *  - header contains synonym or synonym contains header -> 0.7
 *  - levenshtein distance <=2 -> 0.6
 *  - otherwise 0
 */
export function detectColumnMapping(headers: string[]): { mapping: ColumnMapping; confidence: Record<LogicalField, number> } {
  const mapping: ColumnMapping = {
    name: null, phone: null, acquired_at: null, rating: null, comment: null, opt_in_whatsapp: null, email: null, key_attributes: null,
  };
  const confidence: Record<LogicalField, number> = {
    name: 0, phone: 0, acquired_at: 0, rating: 0, comment: 0, opt_in_whatsapp: 0, email: 0, key_attributes: 0,
  };
  const usedHeaders = new Set<string>();

  const normalizedHeaders = headers.map(h => ({ raw: h, norm: normalizeForCompare(h) }));

  for (const field of Object.keys(SYNONYMS) as LogicalField[]) {
    let best: { header: string | null; score: number } = { header: null, score: 0 };
    const syns = SYNONYMS[field].map(normalizeForCompare);

    for (const { raw, norm } of normalizedHeaders) {
      if (usedHeaders.has(raw)) continue;
      let score = 0;
      if (syns.includes(norm)) {
        score = 0.95;
        if (norm === field.replace('_',' ')) score = 1.0;
      } else if (syns.some(s => norm === s)) {
        score = 0.95;
      } else if (syns.some(s => norm.includes(s) || s.includes(norm))) {
        // avoid overly permissive: require at least 3 chars
        if (norm.length >= 3) score = 0.7;
      } else {
        // levenshtein fallback
        const minDist = Math.min(...syns.map(s => levenshtein(norm, s)));
        if (minDist <= 2 && norm.length >= 3) score = 0.6 - minDist * 0.1;
      }
      // tie-break prefer earlier header?
      if (score > best.score) best = { header: raw, score };
    }
    if (best.header && best.score >= 0.6) {
      mapping[field] = best.header;
      confidence[field] = best.score;
      usedHeaders.add(best.header);
    }
  }
  return { mapping, confidence };
}

export function needsConfirmation(mapping: ColumnMapping, confidence: Record<LogicalField, number>): boolean {
  // required fields must be confidently matched
  const required: LogicalField[] = ['name','phone','acquired_at'];
  for (const f of required) {
    if (!mapping[f] || confidence[f] < 0.6) return true;
  }
  return false;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({length: m+1}, () => Array(n+1).fill(0));
  for (let i=0;i<=m;i++) dp[i][0]=i;
  for (let j=0;j<=n;j++) dp[0][j]=j;
  for (let i=1;i<=m;i++) for(let j=1;j<=n;j++) {
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  }
  return dp[m][n];
}

// Helper to coerce mapping JSON from DB
export function parseMappingJson(json: any): ColumnMapping | null {
  if (!json) return null;
  try {
    if (typeof json === 'string') return JSON.parse(json);
    return json as ColumnMapping;
  } catch { return null; }
}
