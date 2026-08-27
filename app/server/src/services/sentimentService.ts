import { analyzeSentiment, hashComment } from '../domain/Sentiment.js';

export interface SentimentService {
  analyze(comment: string | null | undefined): { label: 'positive'|'neutral'|'negative'; score: number; hash: string | null };
  analyzeBatch(comments: (string|null|undefined)[]): Map<string, { label: string; score: number }>;
}

export class LocalSentimentService implements SentimentService {
  private cache = new Map<string, { label: 'positive'|'neutral'|'negative'; score: number }>();
  analyze(comment: string | null | undefined) {
    if (!comment || !comment.trim()) return { label: 'neutral' as const, score: 0, hash: null };
    const hash = hashComment(comment);
    const cached = this.cache.get(hash);
    if (cached) return { ...cached, hash };
    const result = analyzeSentiment(comment);
    this.cache.set(hash, result);
    return { ...result, hash };
  }
  analyzeBatch(comments: (string|null|undefined)[]) {
    const m = new Map<string, { label: string; score: number }>();
    for (const c of comments) {
      if (!c) continue;
      const h = hashComment(c);
      if (!m.has(h) && !this.cache.has(h)) {
        const r = analyzeSentiment(c);
        this.cache.set(h, r);
        m.set(h, r);
      } else if (this.cache.has(h)) {
        m.set(h, this.cache.get(h)!);
      }
    }
    return m;
  }
  clear() { this.cache.clear(); }
}

export class MockSentimentService implements SentimentService {
  analyze(comment: string | null | undefined) {
    if (!comment) return { label: 'neutral' as const, score: 0, hash: null };
    const h = hashComment(comment);
    // deterministic mock: length mod
    const mod = comment.length % 3;
    const label = mod === 0 ? 'positive' as const : mod === 1 ? 'negative' as const : 'neutral' as const;
    return { label, score: mod===0?0.8:mod===1?-0.6:0, hash: h };
  }
  analyzeBatch(comments: (string|null|undefined)[]) {
    const m = new Map();
    for (const c of comments) if (c) { const r=this.analyze(c); m.set(r.hash!, {label:r.label, score:r.score});}
    return m;
  }
}

export const sentimentService = new LocalSentimentService();
