import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useGlobalFilters, toApiParams } from '@/lib/filters';
import { Card, Badge } from '@/components/ui';

function fmtINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
}

export function PnL() {
  const { filters } = useGlobalFilters();
  const { data, isLoading } = useQuery({
    queryKey: ['pnl', filters],
    queryFn: () => api.pnl(toApiParams(filters)),
  });

  if (isLoading) return <div className="p-8 text-center mono text-sm text-stone">Calculating P&L…</div>;
  if (!data) return <div className="p-8 text-center text-stone">No data — add revenue and expenses</div>;

  return (
    <div className="max-w-[1280px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="display text-3xl font-semibold">P&L Summary</h1>
          <p className="text-stone text-sm mt-1">
            Consolidated P&L — {filters.city || 'All cities'} · {filters.propertyId ? `Property ${filters.propertyId.slice(0,8)}` : 'All properties'} · {filters.from || '—'} → {filters.to || '—'}
          </p>
        </div>
        <Badge className="bg-surface border-fog">{data.revenue.count} revenue · {data.expenses.count} expenses</Badge>
      </div>

      {/* Summary */}
      <div className="grid md:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="mono text-xs tracking-widest uppercase text-stone">Revenue</div>
          <div className="text-2xl font-semibold mt-1">{fmtINR(data.revenue.total)}</div>
          <div className="text-xs text-stone mt-1">{data.revenue.count} records</div>
        </Card>
        <Card className="p-5">
          <div className="mono text-xs tracking-widest uppercase text-stone">Total Costs</div>
          <div className="text-2xl font-semibold mt-1 text-signal">{fmtINR(data.expenses.total)}</div>
          <div className="text-xs text-stone mt-1">{data.expenses.count} records</div>
        </Card>
        <Card className="p-5">
          <div className="mono text-xs tracking-widest uppercase text-stone">Net Profit</div>
          <div className={`text-2xl font-semibold mt-1 ${data.profit >=0 ? 'text-moss' : 'text-signal'}`}>{fmtINR(data.profit)}</div>
          <div className="text-xs text-stone mt-1">{data.margin.toFixed(1)}% margin</div>
        </Card>
        <Card className="p-5 bg-ink text-white">
          <div className="mono text-xs tracking-widest uppercase opacity-60">Formula</div>
          <div className="text-sm mt-2">Revenue<br/>− Operating Costs<br/>= <span className="font-semibold">Gross Profit</span></div>
          <div className="text-xs opacity-60 mt-2">Single source of truth in backend/reportService</div>
        </Card>
      </div>

      {/* Property breakdown */}
      <Card className="p-5">
        <div className="font-medium">Profit by Property</div>
        <div className="mt-4 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-stone border-b border-fog">
              <tr><th className="text-left p-2">Property</th><th className="text-left p-2">City</th><th className="text-right p-2">Revenue</th><th className="text-right p-2">Costs</th><th className="text-right p-2">Profit</th><th className="text-right p-2">Margin</th></tr>
            </thead>
            <tbody>
              {data.propertyBreakdown.map((p: any) => (
                <tr key={p.propertyId} className="border-b border-fog/50">
                  <td className="p-2 font-medium">{p.propertyName}</td>
                  <td className="p-2"><Badge className="bg-white border-fog text-xs">{p.city}</Badge></td>
                  <td className="p-2 text-right">{fmtINR(p.revenue)}</td>
                  <td className="p-2 text-right text-signal">{fmtINR(p.expenses)}</td>
                  <td className={`p-2 text-right font-semibold ${p.profit >=0 ? 'text-moss' : 'text-signal'}`}>{fmtINR(p.profit)}</td>
                  <td className="p-2 text-right">{p.margin.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* City breakdown */}
      <Card className="p-5">
        <div className="font-medium">Profit by City</div>
        <div className="mt-4 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-stone border-b border-fog">
              <tr><th className="text-left p-2">City</th><th className="text-right p-2">Properties</th><th className="text-right p-2">Revenue</th><th className="text-right p-2">Costs</th><th className="text-right p-2">Profit</th><th className="text-right p-2">Margin</th></tr>
            </thead>
            <tbody>
              {data.cityBreakdown.map((c: any) => (
                <tr key={c.city} className="border-b border-fog/50">
                  <td className="p-2 font-medium">{c.city}</td>
                  <td className="p-2 text-right">{c.propertyCount}</td>
                  <td className="p-2 text-right">{fmtINR(c.revenue)}</td>
                  <td className="p-2 text-right text-signal">{fmtINR(c.expenses)}</td>
                  <td className={`p-2 text-right font-semibold ${c.profit >=0 ? 'text-moss' : 'text-signal'}`}>{fmtINR(c.profit)}</td>
                  <td className="p-2 text-right">{c.margin.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Expense by category */}
      <Card className="p-5">
        <div className="font-medium">Expenses by Category</div>
        <div className="mt-3 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(data.expenses.byCategory).sort((a: any, b: any) => b[1] - a[1]).map(([cat, amt]: any) => (
            <div key={cat} className="flex justify-between items-center p-3 bg-surface rounded-xl border border-fog">
              <span className="text-sm">{cat}</span>
              <span className="font-medium text-signal">{fmtINR(amt)}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Daily trend */}
      <Card className="p-5">
        <div className="font-medium">Daily P&L Trend</div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-stone border-b border-fog">
              <tr><th className="text-left p-2">Date</th><th className="text-right p-2">Revenue</th><th className="text-right p-2">Expenses</th><th className="text-right p-2">Profit</th></tr>
            </thead>
            <tbody>
              {data.daily.slice(-30).map((d: any) => (
                <tr key={d.date} className="border-b border-fog/30">
                  <td className="p-2">{d.date}</td>
                  <td className="p-2 text-right">{fmtINR(d.revenue)}</td>
                  <td className="p-2 text-right text-signal">{fmtINR(d.expenses)}</td>
                  <td className={`p-2 text-right font-medium ${d.profit >=0 ? 'text-moss' : 'text-signal'}`}>{fmtINR(d.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
