import { useState } from 'react';
import { api } from '@/lib/api';
import { Card, Button, StatusPill, Badge } from '@/components/ui';
import { useQuery } from '@tanstack/react-query';

export function Review({ campaignId }: { campaignId: string }) {
  const [sending, setSending] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: campaign } = useQuery({ queryKey: ['campaign', campaignId], queryFn: () => api.getCampaign(campaignId), enabled: !!campaignId });
  const { data: deliveries, refetch } = useQuery({ queryKey: ['deliveries', campaignId], queryFn: () => api.deliveries(campaignId), enabled: !!campaignId, refetchInterval: 2000 });

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const res = await api.send(campaignId);
      setResult(res);
      refetch();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  async function handleRetryAll() {
    if (!deliveries) return;
    const failed = deliveries.filter((d: any) => d.status === 'failed');
    if (!failed.length) return;
    setRetryingAll(true);
    try {
      for (const d of failed) {
        await api.retry(campaignId, d.customerId);
      }
      refetch();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRetryingAll(false);
    }
  }

  const counts = (deliveries || []).reduce((acc: any, d: any) => { acc[d.status] = (acc[d.status] || 0) + 1; return acc; }, {});
  const total = deliveries?.length || 0;
  const failed = deliveries?.filter((d: any) => d.status === 'failed') || [];

  return (
    <div className="space-y-6 max-w-[760px] mx-auto">
      <div className="mono text-[11px] tracking-[0.14em] uppercase text-stone">04 · Review & Post</div>
      <h2 className="display text-[28px] font-[700] tracking-[-0.02em] leading-none">Ready to post?</h2>
      <p className="text-sm text-stone max-w-[560px]">Same message to your set - each stamped per guest. Sends are idempotent and throttled; failed can be retried.</p>

      <Card className="ticket-perf p-6 pt-8">
        <div className="message-staple" />
        <h3 className="display font-[600]">Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 text-sm">
          <div className="bg-paper rounded-xl p-3 border border-fog">
            <div className="mono text-[11px] tracking-[0.08em] uppercase text-stone">Campaign</div>
            <div className="display font-[600]">{campaign?.name}</div>
            <div className="mono text-xs text-stone mt-1">{campaign?.discountPercent}% off · <StatusPill status={campaign?.status || 'draft'} /></div>
            <div className="mono text-[11px] text-stone/60 mt-1">Created {campaign?.createdAt ? new Date(campaign.createdAt).toLocaleDateString() : '-'}</div>
          </div>
          <div className="bg-paper rounded-xl p-3 border border-fog">
            <div className="mono text-[11px] tracking-[0.08em] uppercase text-stone">Message</div>
            <div className="display text-sm font-[600] leading-tight">{campaign?.template?.name || '-'}</div>
            <div className="mono text-xs text-stone mt-1 truncate">{campaign?.template?.body?.slice(0, 90) || 'Default re-engagement'}{campaign?.template?.body?.length > 90 ? '…' : ''}</div>
            <div className="mono text-[11px] text-stone/60 mt-1">{campaign?.template?.whatsappTemplateName || 'custom'} · {campaign?.template?.locale || 'en_US'}</div>
          </div>
          <div className="bg-paper rounded-xl p-3 border border-fog">
            <div className="mono text-[11px] tracking-[0.08em] uppercase text-stone">Recipients · set</div>
            <div className="display font-[600]">{total ? `${total}` : '-'} <span className="mono text-xs font-normal text-stone">guests</span></div>
            <div className="mono text-xs text-stone mt-1">queued {counts.queued || 0} · sent {counts.sent || 0} · delivered {counts.delivered || 0} · read {counts.read || 0} · <span className={counts.failed ? 'text-signal font-medium' : ''}>failed {counts.failed || 0}</span></div>
            {result && <div className="mono text-[11px] text-moss mt-1">Enqueued {result.enqueued} · skipped {result.skipped} {result.failures?.length ? `· ${result.failures.length} pre-check failed` : ''}</div>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={handleSend} disabled={sending} className="rounded-full">{sending ? 'Posting…' : 'Confirm & post →'}</Button>
          <Button variant="outline" onClick={() => refetch()} className="rounded-full">Refresh</Button>
          {failed.length > 0 && (
            <Button variant="brass" onClick={handleRetryAll} disabled={retryingAll} className="rounded-full">
              {retryingAll ? 'Retrying…' : `Retry ${failed.length} failed →`}
            </Button>
          )}
        </div>
        {error && <div className="text-sm text-signal mt-3 bg-signal/10 border border-signal/20 rounded-xl p-2.5">{error}</div>}
        <p className="mono text-[11px] tracking-[0.06em] uppercase text-stone/60 mt-3">Idempotent · already posted not re-posted · queue throttled</p>
      </Card>

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-fog flex items-center justify-between bg-paper">
          <h4 className="display font-[600] text-sm">Per-guest post - live</h4>
          <div className="flex items-center gap-2">
            <Badge className="mono text-[11px] border-fog bg-paper text-stone">{deliveries?.length || 0} messages</Badge>
            {failed.length > 0 && <Badge className="mono text-[11px] border-signal bg-signal text-paper">{failed.length} failed</Badge>}
          </div>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper mono text-[11px] tracking-[0.08em] uppercase text-stone sticky top-0">
              <tr>
                <th className="p-2.5 text-left">Guest</th>
                <th className="p-2.5 text-left">Phone</th>
                <th className="p-2.5 text-left">Status</th>
                <th className="p-2.5 text-left">Try</th>
                <th className="p-2.5 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fog/60">
              {(deliveries || []).map((d: any) => (
                <tr key={d.id} className="hover:bg-paper">
                  <td className="p-2.5 display font-[600]">{d.customer?.name}</td>
                  <td className="p-2.5 mono text-xs">{d.customer?.phoneMasked}</td>
                  <td className="p-2.5">
                    <StatusPill status={d.status} />
                    {d.error && <span className="ml-2 mono text-[11px] text-signal">{d.error.slice(0, 60)}</span>}
                  </td>
                  <td className="p-2.5 mono text-xs">{d.attempt}</td>
                  <td className="p-2.5">
                    {d.status === 'failed' ? (
                      <Button size="sm" variant="outline" className="rounded-full mono text-[11px]" onClick={async () => { await api.retry(campaignId, d.customerId); refetch(); }}>
                        Retry
                      </Button>
                    ) : d.status === 'queued' || d.status === 'sent' ? (
                      <span className="mono text-[11px] text-stone/60">posting…</span>
                    ) : (
                      <span className="mono text-[11px] text-moss">-</span>
                    )}
                  </td>
                </tr>
              ))}
              {!deliveries?.length && (
                <tr>
                  <td colSpan={5} className="p-10 text-center mono text-sm text-stone">
                    No posts yet - set a message and post.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
