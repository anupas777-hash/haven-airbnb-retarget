/**
 * E.164 phone normalization — pure domain logic, no framework deps.
 * Heuristics: strip spaces/dashes/parens, handle leading 00 or +.
 * If no country code, assume US +1 for 10-digit, else keep as-is if already E.164.
 * Valid E.164: +[1-15 digits], first digit 1-9.
 */
export type PhoneResult = { e164: string | null; valid: boolean; raw: string };

export function normalizePhone(raw: string): PhoneResult {
  if (!raw || typeof raw !== 'string') return { e164: null, valid: false, raw: raw || '' };
  let s = raw.trim();
  if (!s) return { e164: null, valid: false, raw };

  // Remove common formatting except leading +
  const hasPlus = s.startsWith('+');
  // keep digits only
  let digits = s.replace(/[^\d]/g, '');
  if (!digits) return { e164: null, valid: false, raw };

  // Handle 00 prefix -> +
  if (s.startsWith('00')) {
    // strip leading 00 after digit extraction: 0044... -> 44...
    const stripped = digits.replace(/^00/, '');
    return validate('+' + stripped, raw);
  }
  if (hasPlus) {
    return validate('+' + digits, raw);
  }
  // No plus: heuristics
  // If 11 digits starting with 1 -> +1...
  if (digits.length === 11 && digits.startsWith('1')) {
    return validate('+' + digits, raw);
  }
  // If 12 digits starting with 91 and next digit 6-9 (India) -> +91...
  if (digits.length === 12 && digits.startsWith('91') && /[6-9]/.test(digits[2])) {
    return validate('+' + digits, raw);
  }
  // If 11 digits starting with 0 and second part looks like Indian (e.g., 094...), strip leading 0
  if (digits.length === 11 && digits.startsWith('0') && /[6-9]/.test(digits[1])) {
    const stripped = digits.slice(1);
    // now 10 digits Indian
    if (stripped.length === 10 && /[6-9]/.test(stripped[0])) return validate('+91' + stripped, raw);
  }
  // If 10 digits -> detect India vs NANP: Indian mobiles start 6-9
  if (digits.length === 10) {
    if (/^[6-9]/.test(digits)) {
      // likely India
      const inTry = validate('+91' + digits, raw);
      if (inTry.valid) return inTry;
    }
    return validate('+1' + digits, raw);
  }
  // If 7-15 digits but not covered, try +digits and see if valid
  if (digits.length >= 7 && digits.length <= 15) {
    return validate('+' + digits, raw);
  }
  return { e164: null, valid: false, raw };
}

function validate(e164: string, raw: string): PhoneResult {
  // E.164 regex: \+[1-9]\d{6,14}
  const re = /^\+[1-9]\d{6,14}$/;
  if (re.test(e164)) return { e164, valid: true, raw };
  return { e164: null, valid: false, raw };
}

export function maskPhone(e164: string | null): string {
  if (!e164) return '—';
  if (e164.length <= 4) return '••••';
  return e164.slice(0, -4).replace(/./g, '•') + e164.slice(-4);
}
