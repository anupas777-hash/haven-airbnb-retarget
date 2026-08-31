import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { Button, Card } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';

type Props = {
  campaignId: string | null;
  sourceId: string | null;
  onSelectionChange: (count: number) => void;
  onContinue: () => void;
  search: string;
  minRating?: number;
  maxRating?: number;
  sentiment: string[];
  selectedIds: Set<string>;
  selectAllMatching: boolean;
  deselected: Set<string>;
  selectedMap: Map<string, any>;
  onToggleRow: (id: string, excluded: boolean, obj?: any) => void;
  onSelectAllPage: (ids: string[], objs: any[]) => void;
  onSelectAllMatching: () => void;
};

export function Audience({
  campaignId,
  sourceId,
  onSelectionChange,
  onContinue,
  search,
  minRating,
  maxRating,
  sentiment,
  selectedIds,
  selectAllMatching,
  deselected,
  selectedMap,
  onToggleRow,
  onSelectAllPage,
  onSelectAllMatching,
}: Props) {
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const scrollRef = useRef<HTMLDivElement>(null);

  const queryKey = ['customers', { search, minRating, maxRating, sentiment, page, campaignId }];
  const { data, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      api.customers({
        search: search || undefined,
        minRating,
        maxRating,
        sentiment: sentiment.length ? sentiment.join(',') : undefined,
        page,
        pageSize,
        campaignId: campaignId || undefined,
      }),
  });

  const items = data?.items || [];
  const total = data?.total || 0;
  const cohortRule = data?.cohortRule || null;

  const { data: totalAllData } = useQuery({
    queryKey: ['customers-totalAll', { search, minRating, maxRating, sentiment }],
    queryFn: () =>
      api.customers({
        search: search || undefined,
        minRating,
        maxRating,
        sentiment: sentiment.length ? sentiment.join(',') : undefined,
        page: 1,
        pageSize: 1,
        from: '1970-01-01',
        to: '2100-01-01',
      }),
    enabled: !!campaignId,
  });
  const totalAll = totalAllData?.total ?? total;
  const hiddenByCohort = Math.max(0, totalAll - total);
  const qc = useQueryClient();

  const selectedCount = selectAllMatching ? total - deselected.size : selectedIds.size;

  useEffect(() => {
    onSelectionChange(selectedCount);
  }, [selectedCount]);

  useEffect(() => {
    setPage(1);
  }, [search, minRating, maxRating, sentiment, campaignId]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  function toggleSelectAllPage() {
    const pageIds = items.filter((r: any) => r.phoneValid).map((r: any) => r.id);
    const objs = items.filter((r: any) => r.phoneValid);
    onSelectAllPage(pageIds, objs);
  }

  async function persistSelection() {
    if (!campaignId) return;
    if (selectAllMatching) {
      await api.setSelection(campaignId, {
        selectAllMatching: true,
        filters: { search: search || undefined, minRating, maxRating, sentiment: sentiment.length ? sentiment : undefined },
        deselectedIds: Array.from(deselected),
      });
    } else {
      await api.setSelection(campaignId, { customerIds: Array.from(selectedIds) });
    }
    onContinue();
  }

  const isExcluded = (r: any) => !r.phoneValid || !r.acquiredAt;
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="space-y-3">
      <div className="paper rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2 border border-fog">
        <div className="mono text-[11px] tracking-[0.06em] uppercase text-stone flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          Previous guests · {cohortRule ? (cohortRule.type === 'lastNDays' ? `${cohortRule.fromDaysAgo}→${cohortRule.toDaysAgo} days ago` : `${cohortRule.from?.slice(0, 10) || '∞'} → ${cohortRule.to?.slice(0, 10) || '∞'}`) : '-'} · {total} shown
          {hiddenByCohort > 0 && <span className="text-signal">· {hiddenByCohort} hidden by date range</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {hiddenByCohort > 0 && (
            <Button size="sm" variant="outline" className="rounded-full" onClick={async () => {
              if (!campaignId) return;
              await api.patchCampaign(campaignId, { cohortRule: { type: 'customRange', from: '1970-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' } as any });
              qc.invalidateQueries({ queryKey: ['customers'] });
              qc.invalidateQueries({ queryKey: ['campaign'] });
              refetch();
            }}>
              Show all
            </Button>
          )}
          <Button size="sm" variant="ghost" className="rounded-full" onClick={() => (window as any).dispatchEvent(new CustomEvent('go-define'))}>
            Adjust in Define
          </Button>
        </div>
      </div>

      {hiddenByCohort > 20 && (
        <div className="bg-accent/10 border border-accent/20 rounded-2xl p-3 mono text-xs">
          {hiddenByCohort} previous guests are outside the current date range. Tap “Show all” above to reveal your full sheet.
        </div>
      )}

      {!selectAllMatching && selectedIds.size > 0 && (
        <div className="paper rounded-2xl p-3 border border-fog">
          <div className="mono text-[11px] tracking-[0.06em] uppercase text-stone">Set · {selectedIds.size} · same message, per-guest</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Array.from(selectedMap.values()).map((c: any) => (
              <span key={c.id} className="inline-flex items-center gap-1 bg-ink text-paper mono text-[11px] rounded-full px-2.5 py-1">
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-fog flex items-center justify-between bg-white">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={toggleSelectAllPage} className="rounded-full">Page</Button>
            <Button variant={selectAllMatching ? 'default' : 'outline'} size="sm" onClick={onSelectAllMatching} className="rounded-full">
              {selectAllMatching ? '✓ All' : 'All matching'}
            </Button>
            <span className="mono text-[11px] tracking-[0.08em] uppercase text-stone hidden sm:inline">{selectedCount} selected</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => refetch()} className="rounded-full">Refresh</Button>
        </div>

        <div ref={scrollRef} className="overflow-auto max-h-[68vh] bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b border-fog mono text-[11px] tracking-[0.08em] uppercase text-stone z-10">
              <tr>
                <th className="p-2.5 w-8"><input type="checkbox" disabled className="accent-ink" /></th>
                <th className="p-2.5 w-12 text-center">Stays</th>
                <th className="p-2.5 text-left">Guest</th>
                <th className="p-2.5 text-left">Phone</th>
                <th className="p-2.5 text-left">First stay</th>
                <th className="p-2.5 text-left">Stars</th>
                <th className="p-2.5 text-left">Your notes</th>
                <th className="p-2.5 text-left">Reviews</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="p-10 text-center mono text-sm text-stone">Reading the ledger…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="p-10 text-center mono text-sm text-stone">No guests match - adjust in Define.</td></tr>
              ) : (
                <>
                  {/* spacer before */}
                  {virtualItems.length > 0 && virtualItems[0].start > 0 && (
                    <tr><td colSpan={8} style={{ height: `${virtualItems[0].start}px` }} /></tr>
                  )}
                  {virtualItems.map((virtualRow) => {
                    const r: any = items[virtualRow.index];
                    const excluded = isExcluded(r);
                    const checked = selectAllMatching ? !deselected.has(r.id) && !excluded : selectedIds.has(r.id);
                    return (
                      <tr key={r.id} data-index={virtualRow.index} ref={virtualizer.measureElement} className={`hover:bg-surface transition border-b border-fog/50 ${excluded ? 'opacity-60 bg-surface' : ''} ${checked ? 'bg-accent/5' : ''}`}>
                        <td className="p-2.5"><input type="checkbox" checked={checked} disabled={excluded} onChange={() => onToggleRow(r.id, excluded, r)} className="accent-ink" /></td>
                        <td className="p-2.5 mono text-xs text-center">
                          <span className={`inline-flex w-7 h-7 rounded-full grid place-items-center text-xs font-medium ${r.repeatCount > 1 ? 'bg-accent text-white' : 'bg-surface border border-fog text-stone'}`}>{r.repeatCount || 1}</span>
                        </td>
                        <td className="p-2.5 font-medium">{r.name}</td>
                        <td className="p-2.5 mono text-xs">{r.phoneMasked}{!r.phoneValid && <span className="ml-1 text-signal">⚠</span>}</td>
                        <td className="p-2.5 mono text-xs">{fmtDate(r.acquiredAt)}</td>
                        <td className="p-2.5 text-amber-500">{r.rating ? '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) : '-'}</td>
                        <td className="p-2.5 max-w-[180px] truncate text-xs text-stone" title={r.keyAttributes || ''}>{r.keyAttributes ? (r.keyAttributes.length > 48 ? r.keyAttributes.slice(0,48)+'…' : r.keyAttributes) : <span className="text-stone/40">-</span>}</td>
                        <td className="p-2.5 max-w-[220px] truncate text-xs text-stone" title={r.comment || ''}>{r.comment ? (r.comment.length>56?r.comment.slice(0,56)+'…':r.comment) : <span className="text-stone/40">-</span>}</td>
                      </tr>
                    );
                  })}
                  {virtualItems.length > 0 && virtualItems[virtualItems.length - 1].end < virtualizer.getTotalSize() && (
                    <tr><td colSpan={8} style={{ height: `${virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end}px` }} /></tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 flex items-center justify-between border-t border-fog bg-white mono text-xs">
          <span className="text-stone">Folio {page} · {Math.ceil(total / pageSize) || 1} · {total} guests</span>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} className="rounded-full">Prev</Button>
            <Button variant="outline" size="sm" disabled={page>=Math.ceil(total/pageSize)} onClick={()=>setPage(p=>p+1)} className="rounded-full">Next</Button>
          </div>
        </div>
      </Card>

      {selectedCount > 0 && (
        <div className="sticky bottom-4 mt-4 flex justify-center">
          <div className="bg-ink text-white rounded-full px-5 py-3 flex items-center gap-4 text-sm shadow-lg">
            <span className="mono text-xs">{selectedCount} set · same message, per-guest</span>
            <Button size="sm" variant="outline" className="rounded-full bg-white text-ink hover:bg-surface" onClick={persistSelection}>Continue →</Button>
          </div>
        </div>
      )}
    </div>
  );
}
