import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useGlobalFilters, toApiParams } from '@/lib/filters';
import { Card, Badge } from '@/components/ui';

function fmtINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}
function fmtNum(n: number) {
  return new Intl.NumberFormat('en-IN').format(Math.round(n || 0));
}

export function Dashboard() {
  const { filters } = useGlobalFilters();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => api.dashboard(toApiParams(filters)),
  });

  if (isLoading) return <div className="p-8 text-center text-stone mono text-sm">Loading dashboard…</div>;
  if (!data) return <div className="p-8 text-center text-stone">No data — add properties and revenue/expenses</div>;

  const kpis = [
    { label: 'Total Revenue', value: fmtINR(data.totalRevenue), sub: `${data.totalBookings} bookings` },
    { label: 'Total Expenses', value: fmtINR(data.totalExpenses), sub: `${data.cityPerformance?.length || 0} cities` },
    { label: 'Net Profit', value: fmtINR(data.netProfit), sub: `${data.profitMargin?.toFixed(1)}% margin`, accent: data.netProfit >=0 ? 'text-moss' : 'text-signal' },
    { label: 'Occupancy', value: `${data.occupancy || 0}%`, sub: `${fmtNum(data.totalNights)} nights` },
    { label: 'ADR', value: fmtINR(data.adr), sub: 'Avg daily rate' },
    { label: 'RevPAR', value: fmtINR(data.revpar), sub: 'Rev per available room' },
  ];

  return (
    <div className="max-w-[1280px] mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="display text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-stone text-sm mt-1">
            {filters.city ? `City: ${filters.city}` : 'All cities'} · {filters.propertyId ? `Property: ${filters.propertyId.slice(0,8)}` : 'All properties'} · {filters.from || '—'} → {filters.to || '—'}
          </p>
        </div>
        <Badge className="bg-surface border-fog">{fmtNum(data.totalBookings)} bookings · {fmtNum(data.totalNights)} nights</Badge>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map(k => (
          <Card key={k.label} className="p-4">
            <div className="mono text-[11px] tracking-widest uppercase text-stone">{k.label}</div>
            <div className={`text-xl font-semibold mt-1 ${k.accent || ''}`}>{k.value}</div>
            <div className="text-xs text-stone mt-1">{k.sub}</div>
          </Card>
        ))}
      </div>

      {/* MTD / YTD */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="font-medium">Month to Date</div>
          <div className="grid grid-cols-3 gap-4 mt-3">
            <div><div className="text-xs text-stone">Revenue</div><div className="font-semibold">{fmtINR(data.mtd?.revenue)}</div></div>
            <div><div className="text-xs text-stone">Expenses</div><div className="font-semibold">{fmtINR(data.mtd?.expenses)}</div></div>
            <div><div className="text-xs text-stone">Profit</div><div className={`font-semibold ${data.mtd?.profit >=0 ? 'text-moss' : 'text-signal'}`}>{fmtINR(data.mtd?.profit)}</div></div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="font-medium">Year to Date</div>
          <div className="grid grid-cols-3 gap-4 mt-3">
            <div><div className="text-xs text-stone">Revenue</div><div className="font-semibold">{fmtINR(data.ytd?.revenue)}</div></div>
            <div><div className="text-xs text-stone">Expenses</div><div className="font-semibold">{fmtINR(data.ytd?.expenses)}</div></div>
            <div><div className="text-xs text-stone">Profit</div><div className={`font-semibold ${data.ytd?.profit >=0 ? 'text-moss' : 'text-signal'}`}>{fmtINR(data.ytd?.profit)}</div></div>
          </div>
        </Card>
      </div>

      {/* Trends */}
      <Card className="p-5">
        <div className="font-medium">30-Day Trend</div>
        <div className="mt-4 space-y-2">
          {data.trends?.revenue?.length ? (
            <div className="overflow-x-auto">
              <div className="flex items-end gap-1 h-24">
                {data.trends.revenue.map((r: any, i: number) => {
                  const max = Math.max(...data.trends.revenue.map((x: any) => x.value), 1);
                  const h = (r.value / max) * 80 + 4;
                  return <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-brass rounded-t" style={{ height: `${h}px` }} title={`${r.date}: ${fmtINR(r.value)}`} />
                  </div>;
                })}
              </div>
              <div className="mono text-[10px] text-stone mt-2">Revenue trend (last 30 days) — {data.trends.revenue.length} points</div>
            </div>
          ) : <div className="text-sm text-stone">No trend data yet</div>}
        </div>
      </Card>

      {/* Property & City Performance */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="font-medium">Property Performance</div>
          <div className="mt-3 space-y-2 max-h-[320px] overflow-auto">
            {data.propertyPerformance?.length ? data.propertyPerformance.map((p: any) => (
              <div key={p.propertyId} className="flex items-center justify-between py-2 border-b border-fog/60 last:border-0">
                <div>
                  <div className="font-medium text-sm">{p.name}</div>
                  <div className="text-xs text-stone">{p.city} · {fmtINR(p.revenue)} rev</div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-medium ${p.profit >=0 ? 'text-moss' : 'text-signal'}`}>{fmtINR(p.profit)}</div>
                  <div className="text-xs text-stone">{fmtINR(p.expenses)} exp</div>
                </div>
              </div>
            )) : <div className="text-sm text-stone">No properties yet</div>}
          </div>
        </Card>
        <Card className="p-5">
          <div className="font-medium">City Performance</div>
          <div className="mt-3 space-y-2">
            {data.cityPerformance?.length ? data.cityPerformance.map((c: any) => (
              <div key={c.city} className="flex items-center justify-between py-2 border-b border-fog/60 last:border-0">
                <div>
                  <div className="font-medium text-sm">{c.city}</div>
                  <div className="text-xs text-stone">{fmtINR(c.revenue)} revenue</div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-medium ${c.profit >=0 ? 'text-moss' : 'text-signal'}`}>{fmtINR(c.profit)} profit</div>
                  <div className="text-xs text-stone">{fmtINR(c.expenses)} costs</div>
                </div>
              </div>
            )) : <div className="text-sm text-stone">No city data</div>}
          </div>
        </Card>
      </div>

      {/* Recent */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="font-medium">Recent Revenue</div>
          <div className="mt-3 space-y-2 max-h-[300px] overflow-auto">
            {data.recentRevenues?.map((r: any) => (
              <div key={r.id} className="flex justify-between text-sm py-1.5 border-b border-fog/40">
                <span>{r.guestName || '—'} · {r.property?.name || r.propertyId?.slice(0,8)} · {new Date(r.date).toLocaleDateString()}</span>
                <span className="font-medium">{fmtINR(r.netRevenue || r.payout || r.baseAmount || 0)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <div className="font-medium">Recent Expenses</div>
          <div className="mt-3 space-y-2 max-h-[300px] overflow-auto">
            {data.recentExpenses?.map((e: any) => (
              <div key={e.id} className="flex justify-between text-sm py-1.5 border-b border-fog/40">
                <span>{e.category} · {e.vendor || ''} · {e.property?.name || ''}</span>
                <span className="font-medium text-signal">{fmtINR(e.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
