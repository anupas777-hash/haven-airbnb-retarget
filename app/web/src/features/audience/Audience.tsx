import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Button, Card, Badge } from '@/components/ui';
import { sentimentColor, fmtDate } from '@/lib/format';
import { useQuery, useQueryClient } from '@tanstack/react-query';

type Props = {
  campaignId: string | null;
  sourceId: string | null;
  onSelectionChange: (count: number) => void;
  onContinue: () => void;
  // lifted filter + selection from Define
  search: string;
  minRating?: number;
  maxRating?: number;
  sentiment: string[];
  selectedIds: Set<string>;
  selectAllMatching: boolean;
  deselected: Set<string>;
  selectedMap: Map<string, any>;
  onToggleSentiment?: (s: string) => void;
  onToggleRow: (id: string, excluded: boolean, obj?: any) => void;
  onSelectAllPage: (ids: string[], objs: any[]) => void;
  onSelectAllMatching: () => void;
  onClearFilters?: () => void;
  onSearchChange?: (v: string) => void;
  onMinRatingChange?: (v: number | undefined) => void;
  onMaxRatingChange?: (v: number | undefined) => void;
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
  const pageSize = 10;

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

  // total without cohort for banner
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

  return (
    <div className="space-y-3">
      {/* cohort banner - Define owns the controls, but we surface the result here too */}
      <div className="paper rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2 border border-fog">
        <div className="mono text-[11px] tracking-[0.06em] uppercase text-stone flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-brass" />
          Lapse · {cohortRule ? (cohortRule.type === 'lastNDays' ? `${cohortRule.fromDaysAgo}→${cohortRule.toDaysAgo} days ago` : `${cohortRule.from?.slice(0, 10) || '∞'} → ${cohortRule.to?.slice(0, 10) || '∞'}`) : '-'} · {total} shown
          {hiddenByCohort > 0 && <span className="text-signal">· {hiddenByCohort} hidden by lapse</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {hiddenByCohort > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full mono text-[11px]"
              onClick={async () => {
                if (!campaignId) return;
                await api.patchCampaign(campaignId, { cohortRule: { type: 'customRange', from: '1970-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' } as any });
                qc.invalidateQueries({ queryKey: ['customers'] });
                qc.invalidateQueries({ queryKey: ['campaign'] });
                refetch();
              }}
            >
              Show all
            </Button>
          )}
          <Button size="sm" variant="ghost" className="rounded-full mono text-[11px]" onClick={() => (window as any).dispatchEvent(new CustomEvent('go-define'))}>
            Adjust in Define
          </Button>
        </div>
      </div>

        {hiddenByCohort > 20 && (
          <div className="bg-brass/10 border border-brass/20 rounded-2xl p-3 mono text-xs text-ink">
            {hiddenByCohort} guests are outside the current date range. Tap “Show all” above to reveal your full sheet.
          </div>
        )}

      {/* selected set preview - when Define has hand-picked */}
      {!selectAllMatching && selectedIds.size > 0 && (
        <div className="paper rounded-2xl p-3 border border-fog">
          <div className="mono text-[11px] tracking-[0.06em] uppercase text-stone">Set · {selectedIds.size} · same ticket, per-guest stamp</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Array.from(selectedMap.values()).map((c: any) => (
              <span key={c.id} className="inline-flex items-center gap-1 bg-ink text-paper mono text-[11px] rounded-full px-2.5 py-1">
                {c.name}
              </span>
            ))}
            {Array.from(selectedIds).filter((id) => !selectedMap.has(id)).length > 0 && (
              <span className="mono text-xs text-stone">+{Array.from(selectedIds).filter((id) => !selectedMap.has(id)).length} more</span>
            )}
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-fog flex items-center justify-between bg-paper">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={toggleSelectAllPage} className="rounded-full">
              Page
            </Button>
            <Button variant={selectAllMatching ? 'default' : 'outline'} size="sm" onClick={onSelectAllMatching} className="rounded-full">
              {selectAllMatching ? '✓ All' : 'All matching'}
            </Button>
            <span className="mono text-[11px] tracking-[0.08em] uppercase text-stone hidden sm:inline">{selectedCount} selected</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => refetch()} className="rounded-full">
            Refresh
          </Button>
        </div>
        <div className="overflow-auto max-h-[560px] bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-paper border-b border-fog mono text-[11px] tracking-[0.08em] uppercase text-stone">
              <tr>
                <th className="p-2.5 w-8">
                  <input type="checkbox" disabled className="accent-ink" />
                </th>
                <th className="p-2.5 text-left font-medium">Guest</th>
                <th className="p-2.5 text-left font-medium">Phone</th>
                <th className="p-2.5 text-left font-medium">First stay</th>
                <th className="p-2.5 text-left font-medium">Stars</th>
                <th className="p-2.5 text-left font-medium">Tone</th>
                <th className="p-2.5 text-left font-medium">Reviews</th>
                <th className="p-2.5 text-left font-medium">Opt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fog/60">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center mono text-sm text-stone">
                    Reading the ledger…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center mono text-sm text-stone">
                    No guests match - adjust in Define or pull a name by hand there.
                  </td>
                </tr>
              ) : (
                items.map((r: any) => {
                  const excluded = isExcluded(r);
                  const checked = selectAllMatching ? !deselected.has(r.id) && !excluded : selectedIds.has(r.id);
                  return (
                    <tr key={r.id} className={`hover:bg-paper transition ${excluded ? 'opacity-60 bg-fog/20' : ''} ${checked ? 'bg-brass/10' : ''}`}>
                      <td className="p-2.5">
                        <input type="checkbox" checked={checked} disabled={excluded} onChange={() => onToggleRow(r.id, excluded, r)} className="accent-ink" />
                      </td>
                      <td className="p-2.5 display font-[600] text-[14px]">{r.name}</td>
                      <td className="p-2.5 mono text-xs tracking-wide">
                        {r.phoneMasked}
                        {!r.phoneValid && <span className="ml-1 text-signal">⚠</span>}
                      </td>
                      <td className="p-2.5 mono text-xs">{fmtDate(r.acquiredAt)}</td>
                      <td className="p-2.5 text-brass">{r.rating ? '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) : '-'}</td>
                      <td className="p-2.5">
                        <Badge className={`mono text-[11px] border ${sentimentColor(r.sentimentLabel)}`}>{r.sentimentLabel}</Badge>
                      </td>
                      <td className="p-2.5 max-w-[220px] truncate text-stone" title={r.comment || ''}>
                        {r.comment ? (r.comment.length > 60 ? r.comment.slice(0, 60) + '…' : r.comment) : <span className="text-stone/40">-</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 flex items-center justify-between border-t border-fog bg-paper mono text-xs">
          <span className="text-stone">
            Folio {page} · {Math.ceil(total / pageSize) || 1} · {total} guests
          </span>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-full">
              Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((p) => p + 1)} className="rounded-full">
              Next
            </Button>
          </div>
        </div>
      </Card>
      {selectedCount > 0 && (
        <div className="sticky bottom-4 mt-4 flex justify-center">
          <div className="bg-ink text-paper rounded-full px-5 py-3 flex items-center gap-4 text-sm shadow-ticket">
            <span className="mono text-xs tracking-wide">{selectedCount} set · same ticket, per-guest stamp</span>
            <Button size="sm" variant="brass" className="rounded-full" onClick={persistSelection}>
              Set ticket →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}