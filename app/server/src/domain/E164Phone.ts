import { parsePhoneNumberFromString } from 'libphonenumber-js';

export type PhoneResult = { e164: string | null; valid: boolean; raw: string };

export function normalizePhone(raw: string): PhoneResult {
  if (!raw || typeof raw !== 'string') return { e164: null, valid: false, raw: raw || '' };
  const s = raw.trim();
  if (!s) return { e164: null, valid: false, raw };

  // Default to IN for this business (almost all Indian) - try IN first
  const candidates: Array<string | undefined> = ['IN', 'US', undefined];
  for (const country of candidates) {
    try {
      const parsed = parsePhoneNumberFromString(s, country as any);
      if (parsed && parsed.isValid()) {
        return { e164: parsed.format('E.164'), valid: true, raw };
      }
      if (parsed && parsed.isPossible() && parsed.number) {
        const e164 = parsed.format('E.164');
        if (/^\+[1-9]\d{6,14}$/.test(e164)) return { e164, valid: true, raw };
      }
    } catch {}
  }

  // Fallback to previous heuristic for edge cases
  let digits = s.replace(/[^\d]/g, '');
  if (!digits) return { e164: null, valid: false, raw };
  if (s.startsWith('00')) {
    const stripped = digits.replace(/^00/, '');
    return validate('+' + stripped, raw);
  }
  if (s.startsWith('+')) return validate('+' + digits, raw);
  // Default 10-digit to +91 (Indian) for this portfolio
  if (digits.length === 10) return validate('+91' + digits, raw);
  if (digits.length >= 7 && digits.length <= 15) return validate('+' + digits, raw);
  return { e164: null, valid: false, raw };
}

function validate(e164: string, raw: string): PhoneResult {
  const re = /^\+[1-9]\d{6,14}$/;
  if (re.test(e164)) return { e164, valid: true, raw };
  return { e164: null, valid: false, raw };
}

export function maskPhone(e164: string | null): string {
  if (!e164) return '—';
  if (e164.length <= 4) return '••••';
  return e164.slice(0, -4).replace(/./g, '•') + e164.slice(-4);
}
