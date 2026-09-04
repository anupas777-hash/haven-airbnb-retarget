import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, Button, Badge, Input, Label } from '@/components/ui';

export function Properties() {
  const qc = useQueryClient();
  const { data: properties, isLoading } = useQuery({ queryKey: ['properties'], queryFn: () => api.properties() });
  const { data: cities } = useQuery({ queryKey: ['cities'], queryFn: () => api.cities() });

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', city: '', country: 'India', address: '', airbnbListingId: '', type: '', bedrooms: '', beds: '', sheetUrl: '', color: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setSaving(true); setError(null);
    try {
      if (!form.name || !form.city) throw new Error('Name and city required');
      await api.createProperty({
        name: form.name,
        city: form.city,
        country: form.country,
        address: form.address,
        airbnbListingId: form.airbnbListingId,
        type: form.type,
        bedrooms: form.bedrooms ? parseInt(form.bedrooms) : undefined,
        beds: form.beds ? parseInt(form.beds) : undefined,
        sheetUrl: form.sheetUrl || undefined,
        color: form.color || undefined,
      });
      setForm({ name: '', city: '', country: 'India', address: '', airbnbListingId: '', type: '', bedrooms: '', beds: '', sheetUrl: '', color: '' });
      setShowNew(false);
      qc.invalidateQueries({ queryKey: ['properties'] });
      qc.invalidateQueries({ queryKey: ['cities'] });
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (isLoading) return <div className="p-8 text-center mono text-sm text-stone">Loading properties…</div>;

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="display text-3xl font-semibold">Properties</h1>
          <p className="text-stone text-sm mt-1">Manage your Airbnb portfolio — {properties?.length || 0} properties across {cities?.length || 0} cities. Adding a property is config, not code.</p>
        </div>
        <Button onClick={() => setShowNew(v => !v)} className="rounded-full">{showNew ? 'Cancel' : '+ New Property'}</Button>
      </div>

      {showNew && (
        <Card className="p-6 space-y-4">
          <h3 className="font-medium">New Property</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div><Label>Property Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="AJ's Style - 202" /></div>
            <div><Label>City *</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="Goa" /></div>
            <div><Label>Country</Label><Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} placeholder="India" /></div>
            <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Full address" /></div>
            <div><Label>Airbnb Listing ID</Label><Input value={form.airbnbListingId} onChange={e => setForm({ ...form, airbnbListingId: e.target.value })} placeholder="12345678" /></div>
            <div><Label>Type</Label><Input value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} placeholder="Apartment / Villa" /></div>
            <div><Label>Bedrooms</Label><Input type="number" value={form.bedrooms} onChange={e => setForm({ ...form, bedrooms: e.target.value })} placeholder="2" /></div>
            <div><Label>Beds</Label><Input type="number" value={form.beds} onChange={e => setForm({ ...form, beds: e.target.value })} placeholder="3" /></div>
            <div className="md:col-span-2"><Label>Google Sheet URL (property-specific)</Label><Input value={form.sheetUrl} onChange={e => setForm({ ...form, sheetUrl: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/.../edit" /></div>
            <div><Label>Color (UI accent)</Label><Input value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} placeholder="#C8A96A" /></div>
          </div>
          {error && <div className="text-sm text-signal bg-red-50 border border-red-200 rounded-xl p-3">{error}</div>}
          <Button onClick={handleCreate} disabled={saving} className="rounded-full">{saving ? 'Saving…' : 'Create Property'}</Button>
        </Card>
      )}

      {/* Cities overview */}
      {cities && cities.length > 0 && (
        <div className="grid md:grid-cols-3 gap-3">
          {cities.map((c: any) => (
            <Card key={c.city} className="p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">{c.city}</div>
                <Badge className="bg-surface border-fog">{c.propertyCount} properties</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {c.properties.map((p: any) => <Badge key={p.id} className="bg-white border-fog text-xs">{p.name}</Badge>)}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Property grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {properties?.map((p: any) => (
          <Card key={p.id} className="p-5 hover:shadow-lift transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-stone mt-0.5">{p.city}, {p.country} · {p.type || 'Property'} {p.bedrooms ? `· ${p.bedrooms}BR` : ''}</div>
              </div>
              <Badge className={p.status === 'active' ? 'bg-moss/10 text-moss border-moss/20' : 'bg-surface border-fog'}>{p.status}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div><div className="text-stone">Revenue</div><div className="font-medium">{p._count?.revenues || 0}</div></div>
              <div><div className="text-stone">Expenses</div><div className="font-medium">{p._count?.expenses || 0}</div></div>
              <div><div className="text-stone">Guests</div><div className="font-medium">{p._count?.customers || 0}</div></div>
            </div>
            {p.sheetUrl && <div className="mt-3 text-xs text-stone truncate">Sheet: {p.sheetUrl.slice(0,40)}…</div>}
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" className="rounded-full text-xs" onClick={() => window.dispatchEvent(new CustomEvent('go-property', { detail: p.id }))}>View →</Button>
              <Button size="sm" variant="ghost" className="rounded-full text-xs" onClick={async () => { if (!confirm(`Delete ${p.name}?`)) return; await api.deleteProperty(p.id); qc.invalidateQueries({ queryKey: ['properties'] }); }}>Delete</Button>
            </div>
          </Card>
        ))}
      </div>

      {(!properties || properties.length === 0) && !showNew && (
        <Card className="p-12 text-center">
          <div className="display text-xl">No properties yet</div>
          <p className="text-stone text-sm mt-2">Add your first Airbnb property — this creates the city/property filters for the whole OS.</p>
          <Button onClick={() => setShowNew(true)} className="rounded-full mt-4">+ Add Property</Button>
        </Card>
      )}
    </div>
  );
}
