import { useState } from 'react';
import { api } from '@/lib/api';
import { Card, Button, Input, Label, Badge } from '@/components/ui';
import { useQueryClient } from '@tanstack/react-query';

export function Onboarding({ onDone }: { onDone: (sourceId: string, needsMapping?: boolean) => void }) {
  const [url, setUrl] = useState('https://docs.google.com/spreadsheets/d/1WzRK4mYfI_e3io3wDZJttPxaecNU9lh-GkO0ILcsoTU/edit');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const qc = useQueryClient();

  async function handleIngest() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.ingest(url);
      setResult(res);
      qc.invalidateQueries();
      if (res.needsConfirmation) {
        onDone(res.sourceId, true);
      } else {
        setTimeout(() => onDone(res.sourceId, false), 520);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-[560px] mx-auto">
      <Card className="ticket-perf p-6 md:p-8 pt-10 animate-rise">
        <div className="ticket-staple" />
        <div className="mono text-[11px] tracking-[0.14em] uppercase text-stone">01 · Lend the ledger</div>
        <h2 className="display text-[28px] font-[700] tracking-[-0.02em] leading-none mt-2">Paste the guest sheet.</h2>
        <p className="text-sm leading-5 text-stone mt-2">We read the hand - names, phones, first stays, stars, reviews - score the tone, and lay the previous guests at the top. No config.</p>

        <div className="mt-6 space-y-3">
          <div className="space-y-2">
            <Label>Guest sheet URL</Label>
            <div className="flex gap-2">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/.../edit" className="flex-1" />
              <Button onClick={handleIngest} disabled={loading || !url} className="rounded-full shrink-0">
                {loading ? 'Reading…' : 'Sync →'}
              </Button>
            </div>
            <p className="mono text-[11px] leading-4 text-stone/70">Make it “Anyone with the link - Viewer”. Private sheets need pantry key - share with the pantry email in Settings.</p>
          </div>

          <div className="flex items-center gap-2 py-2">
            <span className="stamp text-[10px] border-stone text-stone px-1.5 py-0.5">Proof</span>
            <span className="mono text-[11px] tracking-[0.06em] uppercase text-stone">Messages are stamped, not posted - until you go live</span>
          </div>

          {error && <div className="text-sm text-signal bg-signal/10 border border-signal/20 rounded-xl p-3">{error}</div>}
          {result && !result.needsConfirmation && (
            <div className="text-sm bg-moss/10 border border-moss/20 rounded-xl p-3 mono">
              <div className="font-medium text-moss">Laid · {result.added} new · {result.updated} updated · {result.skipped} skipped</div>
              <div className="text-stone text-xs mt-1">{result.title} · {result.detectedMapping?.name || ''} → {result.detectedMapping?.phone || ''}</div>
            </div>
          )}

          <details className="mono text-[11px] leading-4 text-stone/70 bg-paper border border-fog rounded-xl p-3">
            <summary className="cursor-pointer text-ink font-medium">How the hand is read</summary>
            <p className="mt-2">We match headers by hand, not config: name/customer, phone/mobile, acquired/signup/date, stars/rating, comment/review, opt-in/consent, email. ≥0.6 confidence posts automatically; otherwise you tap once to map and we remember the sheet.</p>
          </details>
        </div>
      </Card>
      <p className="mono text-[11px] tracking-[0.06em] uppercase text-stone/60 text-center mt-4">No credentials to try · “Sync” re-reads the sheet anytime</p>
    </div>
  );
}

export function MappingConfirm({ sourceId, onConfirmed }: { sourceId: string; onConfirmed: () => void }) {
  const [mapping, setMapping] = useState<any>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // useEffect not useState for data fetch
  useState(() => {
    (async () => {
      try {
        const data = await api.getMapping(sourceId);
        const detected = data.detectedMapping || data.confirmedMapping;
        setMapping(detected || { name: null, phone: null, acquired_at: null, rating: null, comment: null, opt_in_whatsapp: null, email: null });
        const hdrs = Object.values(detected || {}).filter(Boolean) as string[];
        setHeaders([...new Set([...hdrs, 'Customer Name', 'Phone', 'Acquired Date', 'Rating', 'Comment', 'Opt In WhatsApp', 'Email', 'full name', 'mobile', 'signup', 'stars', 'review', 'consent', 'mail'])]);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  });

  if (loading) return <div className="paper rounded-2xl p-8 text-center mono text-sm text-stone animate-rise">Reading the columns…</div>;
  const fields: Array<[string, string]> = [
    ['name', 'Name *'],
    ['phone', 'Phone *'],
    ['acquired_at', 'First visit *'],
    ['rating', 'Stars'],
    ['comment', 'Marginalia'],
    ['opt_in_whatsapp', 'Opt-in'],
    ['email', 'Email'],
  ];

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.confirmMapping(sourceId, mapping);
      onConfirmed();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-[640px] mx-auto">
      <div className="ticket-perf paper rounded-2xl p-6 md:p-8 pt-10 animate-rise">
        <div className="ticket-staple" />
        <div className="mono text-[11px] tracking-[0.14em] uppercase text-stone">Ledger · Column hand</div>
        <h2 className="display text-[26px] font-[700] tracking-[-0.02em] leading-none mt-2">Confirm the hand.</h2>
        <p className="text-sm text-stone mt-2">We couldn’t read the required columns with confidence. Tap the right header for each - we remember this ledger.</p>

        <div className="mt-6 space-y-3">
          {fields.map(([key, label]) => (
            <div key={key} className="flex items-center gap-3">
              <Label className="w-28 shrink-0">{label}</Label>
              <select value={mapping?.[key] || ''} onChange={(e) => setMapping({ ...mapping, [key]: e.target.value || null })} className="flex h-9 w-full rounded-full border border-fog bg-white px-3 text-sm focus:border-brass focus:ring-2 focus:ring-brass/20">
                <option value="">- not mapped -</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {error && <div className="text-sm text-signal bg-signal/10 border border-signal/20 rounded-xl p-3">{error}</div>}
          <Button onClick={save} disabled={saving} className="w-full rounded-full">
            {saving ? 'Setting…' : 'Confirm & lay the table →'}
          </Button>
          <p className="mono text-[11px] text-stone/60 text-center">We persist this map per sheet, never asked again.</p>
        </div>
      </div>
    </div>
  );
}
