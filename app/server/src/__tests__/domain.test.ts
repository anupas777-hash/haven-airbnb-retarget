import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../domain/E164Phone.js';
import { detectColumnMapping } from '../domain/ColumnMapping.js';
import { cohortMatches, parseDateLenient } from '../domain/CohortRule.js';
import { analyzeSentiment } from '../domain/Sentiment.js';
import { interpolateTemplate } from 'shared';

describe('E164Phone', () => {
  it('normalizes US 10-digit to +1', () => {
    expect(normalizePhone('415-555-0101').e164).toBe('+14155550101');
    expect(normalizePhone('(415) 555-0101').valid).toBe(true);
  });
  it('handles + prefix', () => {
    expect(normalizePhone('+44 20 7123 4567').e164).toBe('+442071234567');
  });
  it('handles 00 prefix', () => {
    expect(normalizePhone('00442071234567').e164).toBe('+442071234567');
  });
  it('rejects invalid', () => {
    expect(normalizePhone('invalid-phone').valid).toBe(false);
    expect(normalizePhone('').valid).toBe(false);
  });
});

describe('ColumnMapping fuzzy', () => {
  it('matches synonyms case-insensitive', () => {
    const { mapping, confidence } = detectColumnMapping(['full name','mobile','signup','stars','review','consent','mail']);
    expect(mapping.name).toBe('full name');
    expect(mapping.phone).toBe('mobile');
    expect(mapping.acquired_at).toBe('signup');
    expect(mapping.rating).toBe('stars');
    expect(mapping.comment).toBe('review');
    expect(confidence.name).toBeGreaterThanOrEqual(0.6);
  });
  it('matches underscore and spacing variants', () => {
    const { mapping } = detectColumnMapping(['Customer Name','Phone Number','Acquired Date','Rating','Comment','Opt In WhatsApp']);
    expect(mapping.name).toBe('Customer Name');
    expect(mapping.phone).toBe('Phone Number');
  });
});

describe('CohortRule', () => {
  it('matches 30-37 day window', () => {
    const now = new Date();
    const d32 = new Date(now); d32.setDate(now.getDate()-32);
    const d10 = new Date(now); d10.setDate(now.getDate()-10);
    const rule = { type:'lastNDays' as const, fromDaysAgo:37, toDaysAgo:30 };
    expect(cohortMatches(d32, rule)).toBe(true);
    expect(cohortMatches(d10, rule)).toBe(false);
  });
  it('parses dates leniently', () => {
    expect(parseDateLenient('2026-07-24')).not.toBeNull();
    expect(parseDateLenient('07/24/2026')).not.toBeNull();
    expect(parseDateLenient('not-a-date')).toBeNull();
  });
  it('customRange', () => {
    const d = new Date('2026-07-15');
    const rule = { type:'customRange' as const, from: '2026-07-10T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z' };
    expect(cohortMatches(d, rule)).toBe(true);
  });
});

describe('Sentiment', () => {
  it('positive', () => {
    expect(analyzeSentiment('Absolutely loved it! Will come back').label).toBe('positive');
  });
  it('negative', () => {
    expect(analyzeSentiment('Terrible, will not return').label).toBe('negative');
  });
  it('neutral empty', () => {
    expect(analyzeSentiment('').label).toBe('neutral');
    expect(analyzeSentiment(null as any).label).toBe('neutral');
  });
});

describe('interpolateTemplate', () => {
  it('replaces variables', () => {
    expect(interpolateTemplate('Hi {{name}} — {{discount}} off', {name:'Ava', discount:'10%'})).toBe('Hi Ava — 10% off');
    expect(interpolateTemplate('Hi {{1}} you get {{2}}', {'1':'Ava','2':'10%'})).toBe('Hi Ava you get 10%');
  });
});
