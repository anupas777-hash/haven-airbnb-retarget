export function mask(phoneE164: string | null): string {
  if (!phoneE164) return '-';
  return phoneE164.slice(0,-4).replace(/./g,'•') + phoneE164.slice(-4);
}
export function fmtDate(d: string | null): string {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('en-GB', { month:'short', day:'numeric', year:'numeric' }); } catch { return d; }
}
export function sentimentColor(label:string) {
  if (label==='positive') return 'bg-moss/10 text-moss border-moss/20';
  if (label==='negative') return 'bg-signal/10 text-signal border-signal/20';
  return 'bg-paper text-stone border-fog';
}
