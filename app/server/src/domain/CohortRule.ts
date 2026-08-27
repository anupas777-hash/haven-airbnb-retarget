import type { CohortRule } from 'shared';

export function cohortMatches(acquiredAt: Date | null, rule: CohortRule): boolean {
  if (!acquiredAt || isNaN(acquiredAt.getTime())) return false;
  const now = new Date();
  if (rule.type === 'lastNDays') {
    // Support both legacy `days` and explicit window from/to DaysAgo
    if (rule.fromDaysAgo !== undefined && rule.toDaysAgo !== undefined) {
      const from = daysAgo(rule.fromDaysAgo);
      const to = daysAgo(rule.toDaysAgo);
      // window: [from (older), to (newer)] inclusive, e.g. 37..30 days ago
      const older = from < to ? from : to;
      const newer = from < to ? to : from;
      // we want acquiredAt between newer? Actually older is farther in past.
      // Example: 37 days ago = 2026-01-10, 30 days ago = 2026-01-17, want between.
      // So older < newer? No older date is earlier (smaller). So check acquiredAt >= older && acquiredAt <= newer
      // But newer is more recent (larger). So older = 37 days ago, newer =30 days ago
      // For default 30-37, older=37daysAgo, newer=30daysAgo
      const start = new Date(Math.min(from.getTime(), to.getTime()));
      const end = new Date(Math.max(from.getTime(), to.getTime()));
      // include full end day
      end.setHours(23,59,59,999);
      return acquiredAt >= start && acquiredAt <= end;
    }
    if (rule.days) {
      const cutoff = daysAgo(rule.days);
      return acquiredAt >= cutoff && acquiredAt <= now;
    }
  }
  if (rule.type === 'customRange') {
    if (rule.from) {
      const from = new Date(rule.from);
      if (!isNaN(from.getTime()) && acquiredAt < from) return false;
    }
    if (rule.to) {
      const to = new Date(rule.to);
      if (!isNaN(to.getTime())) {
        to.setHours(23,59,59,999);
        if (acquiredAt > to) return false;
      }
    }
    return true;
  }
  return false;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - n);
  return d;
}

export function defaultCohortRule(): CohortRule {
  return { type: 'lastNDays', fromDaysAgo: 37, toDaysAgo: 30 };
}

export function parseDateLenient(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Strip ordinal suffixes: 1st, 2nd, 3rd, 4th -> 1,2,3,4
  s = s.replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');
  // Try ISO / natural language first (handles "25 Oct 2025", "Oct 25 2025", "25 Oct 2025", etc.)
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // Try with cleaned variant for "25th Oct 2025" etc. already stripped
  // Try MM/DD/YYYY, DD-MM-YYYY, YYYY/MM/DD
  const m = s.match(/^(\d{1,4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,4})$/);
  if (m) {
    const a = parseInt(m[1],10), b=parseInt(m[2],10), c=parseInt(m[3],10);
    if (a > 31) {
      d = new Date(a, b-1, c);
    } else if (c > 31) {
      if (a > 12) d = new Date(c, b-1, a);
      else d = new Date(c, a-1, b);
    }
    if (!isNaN(d.getTime())) return d;
  }
  // Try "25 Oct 2025" / "Oct 25 2025" explicit
  const dm = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dm) {
    d = new Date(`${dm[2]} ${dm[1]}, ${dm[3]}`);
    if (!isNaN(d.getTime())) return d;
  }
  const dm2 = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (dm2) {
    d = new Date(`${dm2[1]} ${dm2[2]}, ${dm2[3]}`);
    if (!isNaN(d.getTime())) return d;
  }
  d = new Date(Date.parse(s));
  return isNaN(d.getTime()) ? null : d;
}

export function coerceOptIn(raw: any): boolean {
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  const s = String(raw).trim().toLowerCase();
  if (['yes','y','true','1','opt in','opt-in','subscribed','consented','whatsapp ok','ok','allow','allowed'].includes(s)) return true;
  if (['no','n','false','0','opt out','opt-out','unsubscribed','no consent',''].includes(s)) return false;
  // safe default: false
  return false;
}
