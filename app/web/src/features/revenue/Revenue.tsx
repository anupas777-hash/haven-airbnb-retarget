import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useGlobalFilters, toApiParams } from '@/lib/filters';
import { Card, Button, Input, Label, Badge } from '@/components/ui';

function fmtINR(n: any) {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (!num) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num);
}

export function Revenue() {
  const qc = useQueryClient();
  const { filters } = useGlobalFilters();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ propertyId: '', date: new Date().toISOString().split('T')[0], guestName: '', bookingId: '', room: '', baseAmount: '', payout: '', netRevenue: '', nights: '', notes: '' });

  const { data: properties } = useQuery({ queryKey: ['properties'], queryFn: () => api.properties() });
  const { data, isLoading } = useQuery({
    queryKey: ['revenues', filters, search],
    queryFn: () => api.revenues({ ...toApiParams(filters), search: search || undefined, pageSize: 100 }),
  });

  async function handleCreate() {
    try {
      if (!form.propertyId || !form.date) throw new Error('Property and date required');
      await api.createRevenue({
        propertyId: form.propertyId,
        date: form.date,
        guestName: form.guestName || undefined,
        bookingId: form.bookingId || undefined,
        room: form.room || undefined,
        baseAmount: form.baseAmount || undefined,
        payout: form.payout || undefined,
        netRevenue: form.netRevenue || form.payout || form.baseAmount || undefined,
        nights: form.nights || undefined,
        notes: form.notes || undefined,
      });
      setForm({ propertyId: '', date: new Date().toISOString().split('T')[0], guestName: '', bookingId: '', room: '', baseAmount: '', payout: '', netRevenue: '', nights: '', notes: '' });
      setShowNew(false);
      qc.invalidateQueries({ queryKey: ['revenues'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['pnl'] });
    } catch (e: any) { alert(e.message); }
  }

  return (
    <div className="max-w-[1280px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="display text-3xl font-semibold">Revenue</h1>
          <p className="text-stone text-sm mt-1">Log revenue/income — replaces manual Google Sheet edits. {data?.total || 0} records. Fast entry, property-aware.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-full" onClick={async () => { await api.ingestXlsx({}); qc.invalidateQueries({ queryKey: ['revenues'] }); alert('Scanned data/sheets folder for XLSX'); }}>Scan data/sheets</Button>
          <Button onClick={() => setShowNew(v => !v)} className="rounded-full">{showNew ? 'Cancel' : '+ Add Revenue'}</Button>
        </div>
      </div>

      <Card className="p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]"><Label>Search</Label><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Guest, booking ID, room..." /></div>
        <div className="text-sm text-stone">Filtered: {filters.city || 'All cities'} · {filters.propertyId ? `Property ${filters.propertyId.slice(0,8)}` : 'All properties'} · {filters.from || '—'} → {filters.to || '—'}</div>
      </Card>

      {showNew && (
        <Card className="p-6 space-y-4">
          <h3 className="font-medium">Quick Add Revenue</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div><Label>Property *</Label>
              <select value={form.propertyId} onChange={e => setForm({ ...form, propertyId: e.target.value })} className="w-full h-9 rounded-full border border-fog bg-white px-3 text-sm">
                <option value="">Select property</option>
                {properties?.map((p: any) => <option key={p.id} value={p.id}>{p.name} — {p.city}</option>)}
              </select>
            </div>
            <div><Label>Date *</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <div><Label>Guest Name</Label><Input value={form.guestName} onChange={e => setForm({ ...form, guestName: e.target.value })} placeholder="Divya R" /></div>
            <div><Label>Booking ID</Label><Input value={form.bookingId} onChange={e => setForm({ ...form, bookingId: e.target.value })} placeholder="Airbnb ID" /></div>
            <div><Label>Room</Label><Input value={form.room} onChange={e => setForm({ ...form, room: e.target.value })} placeholder="AJ's Style - 202" /></div>
            <div><Label>Nights</Label><Input type="number" value={form.nights} onChange={e => setForm({ ...form, nights: e.target.value })} placeholder="1" /></div>
            <div><Label>Base Amount (INR)</Label><Input type="number" value={form.baseAmount} onChange={e => setForm({ ...form, baseAmount: e.target.value })} placeholder="2037" /></div>
            <div><Label>Payout (INR)</Label><Input type="number" value={form.payout} onChange={e => setForm({ ...form, payout: e.target.value })} placeholder="1800" /></div>
            <div><Label>Net Revenue (INR)</Label><Input type="number" value={form.netRevenue} onChange={e => setForm({ ...form, netRevenue: e.target.value })} placeholder="2000" /></div>
            <div className="md:col-span-3"><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Key attributes, etc." /></div>
          </div>
          <Button onClick={handleCreate} className="rounded-full">Save Revenue</Button>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b border-fog flex items-center justify-between">
          <div className="font-medium">Revenue Ledger — {data?.total || 0} records</div>
          <Badge className="bg-surface border-fog">Sorted by date desc</Badge>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b border-fog text-xs text-stone">
              <tr><th className="text-left p-3">Date</th><th className="text-left p-3">Property</th><th className="text-left p-3">Guest</th><th className="text-left p-3">Room</th><th className="text-right p-3">Amount</th><th className="text-right p-3">Nights</th><th className="text-left p-3">Booking ID</th><th className="text-right p-3">Actions</th></tr>
            </thead>
            <tbody>
              {isLoading ? <tr><td colSpan={8} className="p-8 text-center text-stone">Loading…</td></tr> :
                data?.items?.map((r: any) => (
                  <tr key={r.id} className="border-b border-fog/50 hover:bg-surface/50">
                    <td className="p-3">{new Date(r.date).toLocaleDateString()}</td>
                    <td className="p-3"><Badge className="bg-white border-fog text-xs">{r.property?.name || r.propertyId.slice(0,8)} · {r.property?.city}</Badge></td>
                    <td className="p-3">{r.guestName || '—'}</td>
                    <td className="p-3">{r.room || '—'}</td>
                    <td className="p-3 text-right font-medium">{fmtINR(r.netRevenue || r.payout || r.baseAmount || r.payment)}</td>
                    <td className="p-3 text-right">{r.nights || '—'}</td>
                    <td className="p-3 text-xs">{r.bookingId || '—'}</td>
                    <td className="p-3 text-right"><button onClick={async () => { if (!confirm('Delete?')) return; await api.deleteRevenue(r.id); qc.invalidateQueries({ queryKey: ['revenues'] }); }} className="text-xs text-signal hover:underline">Delete</button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
