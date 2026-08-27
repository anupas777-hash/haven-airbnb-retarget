import { useState, useEffect } from 'react';
import { Input, Label } from '@/components/ui';

export type CohortRule = { type: 'lastNDays' | 'customRange'; fromDaysAgo?: number; toDaysAgo?: number; days?: number; from?: string; to?: string };

export function CohortPanel({ value, onChange, matchCount }: { value: CohortRule; onChange: (r: CohortRule) => void; matchCount?: number }) {
  const [from, setFrom] = useState(value.from?.slice(0, 10) || '');
  const [to, setTo] = useState(value.to?.slice(0, 10) || '');

  useEffect(() => {
    onChange({ type: 'customRange', from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(to).toISOString() : undefined });
  }, [from, to]);

  return (
    <div className="space-y-3">
      <div className="flex gap-3 bg-paper border border-fog rounded-2xl p-3 w-fit">
        <div>
          <Label>Start date</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label>End date</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
        </div>
      </div>
      {matchCount !== undefined && <div className="mono text-[11px] tracking-[0.06em] uppercase text-stone">{matchCount} guests in range</div>}
    </div>
  );
}
