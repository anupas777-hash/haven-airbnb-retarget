import { prisma } from '../repositories/prisma.js';

export type GlobalFilters = {
  city?: string;
  propertyId?: string;
  from?: Date;
  to?: Date;
};

export type PnLReport = {
  filters: GlobalFilters;
  revenue: { total: number; byProperty: Record<string, number>; count: number };
  expenses: { total: number; byCategory: Record<string, number>; byProperty: Record<string, number>; count: number };
  profit: number;
  margin: number;
  // Time series for charts
  daily: Array<{ date: string; revenue: number; expenses: number; profit: number }>;
  // Breakdowns
  propertyBreakdown: Array<{ propertyId: string; propertyName: string; city: string; revenue: number; expenses: number; profit: number; margin: number }>;
  cityBreakdown: Array<{ city: string; revenue: number; expenses: number; profit: number; margin: number; propertyCount: number }>;
};

export type DashboardMetrics = {
  filters: GlobalFilters;
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  profitMargin: number;
  totalBookings: number;
  avgBookingValue: number;
  totalNights: number;
  occupancy: number; // placeholder - needs booking data
  adr: number;
  revpar: number;
  mtd: { revenue: number; expenses: number; profit: number };
  ytd: { revenue: number; expenses: number; profit: number };
  trends: {
    revenue: Array<{ date: string; value: number }>;
    expenses: Array<{ date: string; value: number }>;
    profit: Array<{ date: string; value: number }>;
  };
  propertyPerformance: Array<{ propertyId: string; name: string; city: string; revenue: number; expenses: number; profit: number }>;
  cityPerformance: Array<{ city: string; revenue: number; expenses: number; profit: number }>;
  recentRevenues: any[];
  recentExpenses: any[];
};

function applyFilters<T extends { propertyId?: string; date?: Date | string; checkIn?: Date | string; city?: string }>(
  items: T[],
  properties: any[],
  filters: GlobalFilters
): T[] {
  const propMap = new Map(properties.map(p => [p.id, p]));
  return items.filter(item => {
    if (filters.propertyId && (item as any).propertyId !== filters.propertyId) return false;
    if (filters.city) {
      const prop = propMap.get((item as any).propertyId);
      if (!prop || prop.city !== filters.city) return false;
    }
    const date = (item as any).date || (item as any).checkIn;
    if (date) {
      const d = date instanceof Date ? date : new Date(date);
      if (filters.from && d < filters.from) return false;
      if (filters.to && d > filters.to) return false;
    }
    return true;
  });
}

export async function getPnLReport(filters: GlobalFilters): Promise<PnLReport> {
  const properties = await prisma.property.findMany();
  let revenues = await prisma.revenue.findMany({ include: { property: true } });
  let expenses = await prisma.expense.findMany({ include: { property: true } });

  revenues = applyFilters(revenues, properties, filters) as any;
  expenses = applyFilters(expenses, properties, filters) as any;

  const totalRevenue = revenues.reduce((sum, r: any) => sum + (r.netRevenue ?? r.payout ?? r.baseAmount ?? r.payment ?? 0), 0);
  const totalExpenses = expenses.reduce((sum, e: any) => sum + (e.amount || 0), 0);
  const profit = totalRevenue - totalExpenses;
  const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

  // By property
  const revByProp: Record<string, number> = {};
  const expByProp: Record<string, number> = {};
  const expByCat: Record<string, number> = {};

  for (const r of revenues as any[]) {
    const pid = r.propertyId;
    revByProp[pid] = (revByProp[pid] || 0) + (r.netRevenue ?? r.payout ?? r.baseAmount ?? r.payment ?? 0);
  }
  for (const e of expenses as any[]) {
    const pid = e.propertyId;
    expByProp[pid] = (expByProp[pid] || 0) + (e.amount || 0);
    const cat = e.category || 'Other';
    expByCat[cat] = (expByCat[cat] || 0) + (e.amount || 0);
  }

  // Daily aggregation
  const dailyMap = new Map<string, { revenue: number; expenses: number }>();
  for (const r of revenues as any[]) {
    const d = r.date instanceof Date ? r.date : new Date(r.date);
    const key = d.toISOString().split('T')[0];
    const cur = dailyMap.get(key) || { revenue: 0, expenses: 0 };
    cur.revenue += (r.netRevenue ?? r.payout ?? r.baseAmount ?? r.payment ?? 0);
    dailyMap.set(key, cur);
  }
  for (const e of expenses as any[]) {
    const d = e.date instanceof Date ? e.date : new Date(e.date);
    const key = d.toISOString().split('T')[0];
    const cur = dailyMap.get(key) || { revenue: 0, expenses: 0 };
    cur.expenses += (e.amount || 0);
    dailyMap.set(key, cur);
  }
  const daily = Array.from(dailyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, vals]) => ({ date, revenue: vals.revenue, expenses: vals.expenses, profit: vals.revenue - vals.expenses }));

  // Property breakdown
  const propertyBreakdown = properties.map(p => {
    const rev = revByProp[p.id] || 0;
    const exp = expByProp[p.id] || 0;
    const prof = rev - exp;
    return {
      propertyId: p.id,
      propertyName: p.name,
      city: p.city,
      revenue: rev,
      expenses: exp,
      profit: prof,
      margin: rev > 0 ? (prof / rev) * 100 : 0,
    };
  }).filter(pb => {
    if (filters.propertyId) return pb.propertyId === filters.propertyId;
    if (filters.city) return pb.city === filters.city;
    return true;
  });

  // City breakdown
  const cityMap = new Map<string, { revenue: number; expenses: number; properties: Set<string> }>();
  for (const pb of propertyBreakdown) {
    const cur = cityMap.get(pb.city) || { revenue: 0, expenses: 0, properties: new Set() };
    cur.revenue += pb.revenue;
    cur.expenses += pb.expenses;
    cur.properties.add(pb.propertyId);
    cityMap.set(pb.city, cur);
  }
  const cityBreakdown = Array.from(cityMap.entries()).map(([city, vals]) => ({
    city,
    revenue: vals.revenue,
    expenses: vals.expenses,
    profit: vals.revenue - vals.expenses,
    margin: vals.revenue > 0 ? ((vals.revenue - vals.expenses) / vals.revenue) * 100 : 0,
    propertyCount: vals.properties.size,
  }));

  return {
    filters,
    revenue: { total: totalRevenue, byProperty: revByProp, count: revenues.length },
    expenses: { total: totalExpenses, byCategory: expByCat, byProperty: expByProp, count: expenses.length },
    profit,
    margin,
    daily,
    propertyBreakdown,
    cityBreakdown,
  };
}

export async function getDashboardMetrics(filters: GlobalFilters): Promise<DashboardMetrics> {
  const properties = await prisma.property.findMany();
  let revenues = await prisma.revenue.findMany({ include: { property: true }, orderBy: { date: 'desc' } });
  let expenses = await prisma.expense.findMany({ include: { property: true }, orderBy: { date: 'desc' } });
  let bookings = await prisma.booking.findMany();

  revenues = applyFilters(revenues, properties, filters) as any;
  expenses = applyFilters(expenses, properties, filters) as any;
  bookings = applyFilters(bookings, properties, filters) as any;

  const totalRevenue = revenues.reduce((sum, r: any) => sum + (r.netRevenue ?? r.payout ?? r.baseAmount ?? r.payment ?? 0), 0);
  const totalExpenses = expenses.reduce((sum, e: any) => sum + (e.amount || 0), 0);
  const netProfit = totalRevenue - totalExpenses;
  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  const totalBookings = revenues.length; // Using revenue entries as bookings proxy
  const totalNights = revenues.reduce((sum, r: any) => sum + (r.nights || 0), 0);
  const avgBookingValue = totalBookings > 0 ? totalRevenue / totalBookings : 0;

  // Simplified ADR and RevPAR (need occupancy data for accurate)
  const adr = totalNights > 0 ? totalRevenue / totalNights : 0;
  const revpar = adr * 0.7; // placeholder occupancy 70%

  // MTD and YTD
  const now = new Date();
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const ytdStart = new Date(now.getFullYear(), 0, 1);

  const mtdRevenues = revenues.filter((r: any) => {
    const d = r.date instanceof Date ? r.date : new Date(r.date);
    return d >= mtdStart;
  });
  const mtdExpenses = expenses.filter((e: any) => {
    const d = e.date instanceof Date ? e.date : new Date(e.date);
    return d >= mtdStart;
  });
  const ytdRevenues = revenues.filter((r: any) => {
    const d = r.date instanceof Date ? r.date : new Date(r.date);
    return d >= ytdStart;
  });
  const ytdExpenses = expenses.filter((e: any) => {
    const d = e.date instanceof Date ? e.date : new Date(e.date);
    return d >= ytdStart;
  });

  const mtd = {
    revenue: mtdRevenues.reduce((sum, r: any) => sum + (r.netRevenue ?? r.payout ?? r.baseAmount ?? r.payment ?? 0), 0),
    expenses: mtdExpenses.reduce((sum, e: any) => sum + (e.amount || 0), 0),
    profit: 0,
  };
  mtd.profit = mtd.revenue - mtd.expenses;

  const ytd = {
    revenue: ytdRevenues.reduce((sum, r: any) => sum + (r.netRevenue ?? r.payout ?? r.baseAmount ?? r.payment ?? 0), 0),
    expenses: ytdExpenses.reduce((sum, e: any) => sum + (e.amount || 0), 0),
    profit: 0,
  };
  ytd.profit = ytd.revenue - ytd.expenses;

  // Trends - group by day for last 30 days
  const trendMap = new Map<string, { revenue: number; expenses: number }>();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  for (const r of revenues as any[]) {
    const d = r.date instanceof Date ? r.date : new Date(r.date);
    if (d < thirtyDaysAgo) continue;
    const key = d.toISOString().split('T')[0];
    const cur = trendMap.get(key) || { revenue: 0, expenses: 0 };
    cur.revenue += (r.netRevenue ?? r.payout ?? r.baseAmount ?? r.payment ?? 0);
    trendMap.set(key, cur);
  }
  for (const e of expenses as any[]) {
    const d = e.date instanceof Date ? e.date : new Date(e.date);
    if (d < thirtyDaysAgo) continue;
    const key = d.toISOString().split('T')[0];
    const cur = trendMap.get(key) || { revenue: 0, expenses: 0 };
    cur.expenses += (e.amount || 0);
    trendMap.set(key, cur);
  }

  const sortedTrends = Array.from(trendMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const trends = {
    revenue: sortedTrends.map(([date, v]) => ({ date, value: v.revenue })),
    expenses: sortedTrends.map(([date, v]) => ({ date, value: v.expenses })),
    profit: sortedTrends.map(([date, v]) => ({ date, value: v.revenue - v.expenses })),
  };

  // Property performance
  const revByProp: Record<string, number> = {};
  const expByProp: Record<string, number> = {};
  for (const r of revenues as any[]) revByProp[r.propertyId] = (revByProp[r.propertyId] || 0) + (r.netRevenue ?? r.payout ?? r.baseAmount ?? r.payment ?? 0);
  for (const e of expenses as any[]) expByProp[e.propertyId] = (expByProp[e.propertyId] || 0) + (e.amount || 0);

  const propertyPerformance = properties
    .filter(p => {
      if (filters.propertyId) return p.id === filters.propertyId;
      if (filters.city) return p.city === filters.city;
      return true;
    })
    .map(p => ({
      propertyId: p.id,
      name: p.name,
      city: p.city,
      revenue: revByProp[p.id] || 0,
      expenses: expByProp[p.id] || 0,
      profit: (revByProp[p.id] || 0) - (expByProp[p.id] || 0),
    }))
    .sort((a, b) => b.profit - a.profit);

  // City performance
  const cityMap = new Map<string, { revenue: number; expenses: number }>();
  for (const pp of propertyPerformance) {
    const cur = cityMap.get(pp.city) || { revenue: 0, expenses: 0 };
    cur.revenue += pp.revenue;
    cur.expenses += pp.expenses;
    cityMap.set(pp.city, cur);
  }
  const cityPerformance = Array.from(cityMap.entries()).map(([city, vals]) => ({
    city,
    revenue: vals.revenue,
    expenses: vals.expenses,
    profit: vals.revenue - vals.expenses,
  }));

  return {
    filters,
    totalRevenue,
    totalExpenses,
    netProfit,
    profitMargin,
    totalBookings,
    avgBookingValue,
    totalNights,
    occupancy: 70, // placeholder
    adr,
    revpar,
    mtd,
    ytd,
    trends,
    propertyPerformance,
    cityPerformance,
    recentRevenues: revenues.slice(0, 10),
    recentExpenses: expenses.slice(0, 10),
  };
}
