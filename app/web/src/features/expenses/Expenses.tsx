import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useGlobalFilters, toApiParams } from '@/lib/filters';
import { Card, Button, Input, Label, Badge } from '@/components/ui';

const CATEGORIES = ['Rent','Utilities','Electricity','Water','Internet','Cleaning','Maintenance','Repairs','Supplies','Furniture','Management','Platform Fees','Staff','Salaries','Marketing','Taxes','Insurance','Other'];

function fmtINR(n: any) {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (!num) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num);
}

export function Expenses() {
  const qc = useQueryClient();
  const { filters } = useGlobalFilters();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ propertyId: '', date: new Date().toISOString().split('T')[0], category: 'Other', vendor: '', amount: '', notes: '', paymentMethod: '' });

  const { data: properties } = useQuery({ queryKey: ['properties'], queryFn: () => api.properties() });
  const { data, isLoading } = useQuery({
    queryKey: ['expenses', filters, search, categoryFilter],
    queryFn: () => api.expenses({ ...toApiParams(filters), search: search || undefined, category: categoryFilter || undefined, pageSize: 100 }),
  });
  const { data: categories } = useQuery({ queryKey: ['expense-categories'], queryFn: () => api.expenseCategories() });

  async function handleCreate() {
    try {
      if (!form.propertyId || !form.date || !form.amount) throw new Error('Property, date, amount required');
      await api.createExpense({
        propertyId: form.propertyId,
        date: form.date,
        category: form.category,
        vendor: form.vendor || undefined,
        amount: form.amount,
        notes: form.notes || undefined,
        paymentMethod: form.paymentMethod || undefined,
      });
      setForm({ propertyId: '', date: new Date().toISOString().split('T')[0], category: 'Other', vendor: '', amount: '', notes: '', paymentMethod: '' });
      setShowNew(false);
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['pnl'] });
    } catch (e: any) { alert(e.message); }
  }

  return (
    <div className="max-w-[1280px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="display text-3xl font-semibold">Expenses</h1>
          <p className="text-stone text-sm mt-1">Log costs immediately after they happen — {data?.total || 0} records. Fast entry, category-aware.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-full" onClick={async () => { await api.ingestXlsx({}); qc.invalidateQueries({ queryKey: ['expenses'] }); alert('Scanned data/sheets folder'); }}>Scan data/sheets</Button>
          <Button onClick={() => setShowNew(v => !v)} className="rounded-full">{showNew ? 'Cancel' : '+ Add Expense'}</Button>
        </div>
      </div>

      <Card className="p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]"><Label>Search</Label><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Vendor, notes, category..." /></div>
        <div><Label>Category</Label>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="h-9 rounded-full border border-fog bg-white px-3 text-sm">
            <option value="">All categories</option>
            {(categories && categories.length ? categories : CATEGORIES).map((c: string) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="text-sm text-stone">Filtered: {filters.city || 'All'} · {filters.propertyId ? `Prop ${filters.propertyId.slice(0,8)}` : 'All props'}</div>
      </Card>

      {showNew && (
        <Card className="p-6 space-y-4">
          <h3 className="font-medium">Quick Add Expense</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div><Label>Property *</Label>
              <select value={form.propertyId} onChange={e => setForm({ ...form, propertyId: e.target.value })} className="w-full h-9 rounded-full border border-fog bg-white px-3 text-sm">
                <option value="">Select property</option>
                {properties?.map((p: any) => <option key={p.id} value={p.id}>{p.name} — {p.city}</option>)}
              </select>
            </div>
            <div><Label>Date *</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <div><Label>Category *</Label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full h-9 rounded-full border border-fog bg-white px-3 text-sm">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><Label>Vendor</Label><Input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} placeholder="Electricity Board, Cleaner..." /></div>
            <div><Label>Amount INR *</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="1500" /></div>
            <div><Label>Payment Method</Label><Input value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value })} placeholder="UPI / Cash / Card" /></div>
            <div className="md:col-span-3"><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Monthly electricity, etc." /></div>
          </div>
          <Button onClick={handleCreate} className="rounded-full">Save Expense</Button>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b border-fog flex items-center justify-between">
          <div className="font-medium">Expense Ledger — {data?.total || 0} records</div>
          <Badge className="bg-surface border-fog">{fmtINR(data?.items?.reduce((s: number, e: any) => s + (e.amount || 0), 0))} total</Badge>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b border-fog text-xs text-stone">
              <tr><th className="text-left p-3">Date</th><th className="text-left p-3">Property</th><th className="text-left p-3">Category</th><th className="text-left p-3">Vendor</th><th className="text-right p-3">Amount</th><th className="text-left p-3">Notes</th><th className="text-right p-3">Actions</th></tr>
            </thead>
            <tbody>
              {isLoading ? <tr><td colSpan={7} className="p-8 text-center text-stone">Loading…</td></tr> :
                data?.items?.map((e: any) => (
                  <tr key={e.id} className="border-b border-fog/50 hover:bg-surface/50">
                    <td className="p-3">{new Date(e.date).toLocaleDateString()}</td>
                    <td className="p-3"><Badge className="bg-white border-fog text-xs">{e.property?.name || e.propertyId.slice(0,8)} · {e.property?.city}</Badge></td>
                    <td className="p-3"><Badge className="bg-surface border-fog text-xs">{e.category}</Badge></td>
                    <td className="p-3">{e.vendor || '—'}</td>
                    <td className="p-3 text-right font-medium text-signal">{fmtINR(e.amount)}</td>
                    <td className="p-3 text-xs">{e.notes || '—'}</td>
                    <td className="p-3 text-right"><button onClick={async () => { if (!confirm('Delete?')) return; await api.deleteExpense(e.id); qc.invalidateQueries({ queryKey: ['expenses'] }); }} className="text-xs text-signal hover:underline">Delete</button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
