import { prisma } from '../repositories/prisma.js';
import type { CohortRule } from 'shared';

function parseJsonField(v: any): any {
  if (v==null) return null;
  if (typeof v==='string') try { return JSON.parse(v); } catch { return v; }
  return v;
}
function stringifyField(v:any): string | null {
  if (v==null) return null;
  return typeof v==='string' ? v : JSON.stringify(v);
}

export async function createCampaign(data: { name?: string; cohortRule: CohortRule; discountPercent?: number; templateId?: string; filtersSnapshot?: any }) {
  const name = data.name || `Campaign ${new Date().toISOString().slice(0,10)}`;
  return prisma.campaign.create({
    data: {
      name,
      cohortRule: JSON.stringify(data.cohortRule),
      discountPercent: data.discountPercent ?? 10,
      templateId: data.templateId || null,
      filtersSnapshot: stringifyField(data.filtersSnapshot),
      status: 'draft',
    }
  });
}

export async function patchCampaign(id: string, data: any) {
  return prisma.campaign.update({ where:{ id }, data: {
    ...(data.name!==undefined && {name:data.name}),
    ...(data.cohortRule!==undefined && {cohortRule: JSON.stringify(data.cohortRule)}),
    ...(data.discountPercent!==undefined && {discountPercent:data.discountPercent}),
    ...(data.templateId!==undefined && {templateId:data.templateId}),
    ...(data.filtersSnapshot!==undefined && {filtersSnapshot: stringifyField(data.filtersSnapshot)}),
    ...(data.status!==undefined && {status:data.status}),
  }});
}

export async function setSelection(campaignId: string, selection: { customerIds?: string[]; selectAllMatching?: boolean; filters?: any; deselectedIds?: string[] }) {
  if (selection.selectAllMatching) {
    return prisma.campaign.update({ where:{ id: campaignId }, data:{
      selectionMode: 'allMatching',
      selectionFilters: stringifyField(selection.filters),
      deselectedIds: JSON.stringify(selection.deselectedIds || []),
      selectedIds: JSON.stringify([]),
    }});
  }
  if (selection.customerIds) {
    return prisma.campaign.update({ where:{ id: campaignId }, data:{
      selectionMode: 'ids',
      selectedIds: JSON.stringify(selection.customerIds),
      deselectedIds: JSON.stringify([]),
      selectionFilters: null,
    }});
  }
  return prisma.campaign.findUnique({ where:{ id: campaignId }});
}

export async function resolveSelectionCustomerIds(campaign: any): Promise<string[]> {
  const selIds = parseJsonField(campaign.selectedIds);
  const deselectedIds = parseJsonField(campaign.deselectedIds);
  const selectionFilters = parseJsonField(campaign.selectionFilters);
  const cohortRule = parseJsonField(campaign.cohortRule) as CohortRule;
  if (campaign.selectionMode === 'ids') {
    return (selIds as string[]) || [];
  }
  if (campaign.selectionMode === 'allMatching') {
    const filters = selectionFilters || {};
    let customers = await prisma.customer.findMany();
    customers = filterCustomers(customers, filters, cohortRule);
    let ids = customers.map(c=>c.id);
    const deselected = new Set((deselectedIds as string[]) || []);
    ids = ids.filter(id=> !deselected.has(id));
    return ids;
  }
  return [];
}

// Helper reused in customers query
import { cohortMatches } from '../domain/CohortRule.js';
export function filterCustomers(customers: any[], q: any, cohortRule?: CohortRule) {
  return customers.filter(c=>{
    if (q.optedInOnly && !c.optInWhatsApp) return false;
    if (q.minRating !== undefined && (c.rating==null || c.rating < q.minRating)) return false;
    if (q.maxRating !== undefined && (c.rating==null || c.rating > q.maxRating)) return false;
    if (q.sentiment && q.sentiment.length && !q.sentiment.includes(c.sentimentLabel)) return false;
    if (q.search) {
      const s = q.search.toLowerCase();
      if (!c.name.toLowerCase().includes(s) && !(c.comment||'').toLowerCase().includes(s) && !(c.phoneRaw||'').includes(s)) return false;
    }
    if (cohortRule && !cohortMatches(c.acquiredAt, cohortRule)) return false;
    // additionally acquiredFromDays/ToDays fallback
    if (q.acquiredFromDays!==undefined || q.acquiredToDays!==undefined) {
      if (!c.acquiredAt) return false;
      const daysAgo = Math.floor((Date.now() - new Date(c.acquiredAt).getTime())/86400000);
      if (q.acquiredFromDays!==undefined && daysAgo < q.acquiredFromDays) return false;
      if (q.acquiredToDays!==undefined && daysAgo > q.acquiredToDays) return false;
    }
    // exclude unparseable dates already handled via cohort? If no cohort, allow? but spec says exclude from sending
    return true;
  });
}
