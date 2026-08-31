import { DateTime } from 'luxon';
import type { CohortRule } from 'shared';

export function cohortMatches(acquiredAt: Date | null, rule: CohortRule): boolean {
  if (!acquiredAt || isNaN(acquiredAt.getTime())) return false;
  const now = DateTime.now().setZone('Asia/Kolkata');
  const acq = DateTime.fromJSDate(acquiredAt).setZone('Asia/Kolkata');
  if (rule.type === 'lastNDays') {
    if (rule.fromDaysAgo !== undefined && rule.toDaysAgo !== undefined) {
      const from = DateTime.now().setZone('Asia/Kolkata').startOf('day').minus({ days: Math.max(rule.fromDaysAgo, rule.toDaysAgo) });
      const to = DateTime.now().setZone('Asia/Kolkata').endOf('day').minus({ days: Math.min(rule.fromDaysAgo, rule.toDaysAgo) });
      return acq >= from && acq <= to;
    }
    if (rule.days) {
      const cutoff = DateTime.now().setZone('Asia/Kolkata').startOf('day').minus({ days: rule.days });
      return acq >= cutoff && acq <= now;
    }
  }
  if (rule.type === 'customRange') {
    if (rule.from) {
      const from = DateTime.fromISO(rule.from);
      if (from.isValid && acq < from) return false;
    }
    if (rule.to) {
      const to = DateTime.fromISO(rule.to).endOf('day');
      if (to.isValid && acq > to) return false;
    }
    return true;
  }
  return false;
}

export function defaultCohortRule(): CohortRule {
  return { type: 'customRange' };
}

export function parseDateLenient(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');
  // Try Luxon with multiple formats first (explicit, locale en-IN)
  const formats = [
    "d MMM yyyy", "d MMM yyyy", "dd MMM yyyy", "d MMMM yyyy", "dd MMMM yyyy",
    "MMM d, yyyy", "MMMM d, yyyy", "yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy", "yyyy/MM/dd",
    "d/M/yyyy", "M/d/yyyy",
  ];
  for (const fmt of formats) {
    const dt = DateTime.fromFormat(s, fmt, { zone: 'Asia/Kolkata', locale: 'en-IN' });
    if (dt.isValid) return dt.toJSDate();
  }
  // Try ISO
  let dt = DateTime.fromISO(s, { zone: 'Asia/Kolkata' });
  if (dt.isValid) return dt.toJSDate();
  // Try JS Date as fallback
  const js = new Date(s);
  if (!isNaN(js.getTime())) return js;
  // Try Date.parse
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) return new Date(parsed);
  return null;
}

export function coerceOptIn(raw: any): boolean {
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  const s = String(raw).trim().toLowerCase();
  if (['yes','y','true','1','opt in','opt-in','subscribed','consented','whatsapp ok','ok','allow','allowed'].includes(s)) return true;
  if (['no','n','false','0','opt out','opt-out','unsubscribed','no consent',''].includes(s)) return false;
  return false;
}
