const BASE = '/api';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type':'application/json', ...(opts?.headers||{}) },
    ...opts,
  });
  const json = await res.json().catch(()=> ({}));
  if (!res.ok) {
    const err: any = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.code = json?.error?.code;
    err.details = json?.error?.details;
    err.status = res.status;
    throw err;
  }
  return json as T;
}

export const api = {
  ingest: (url:string, mapping?: any) => req<any>('/sources', { method:'POST', body: JSON.stringify({ url, mapping })}),
  getSources: () => req<any[]>('/sources'),
  getMapping: (id:string) => req<any>(`/sources/${id}/mapping`),
  confirmMapping: (id:string, mapping:any) => req<any>(`/sources/${id}/mapping`, { method:'PUT', body: JSON.stringify({ mapping })}),
  sync: (body:any) => req<any>('/sync', { method:'POST', body: JSON.stringify(body)}),
  customers: (params: Record<string,any>) => {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k,v])=>{
      if (v===undefined||v===null||v==='') return;
      if (Array.isArray(v)) v.forEach(val=> sp.append(k, String(val)));
      else sp.set(k, String(v));
    });
    return req<any>(`/customers?${sp.toString()}`);
  },
  createCampaign: (body:any) => req<any>('/campaigns', { method:'POST', body: JSON.stringify(body)}),
  getCampaigns: () => req<any[]>('/campaigns'),
  getCampaign: (id:string) => req<any>(`/campaigns/${id}`),
  patchCampaign: (id:string, body:any) => req<any>(`/campaigns/${id}`, { method:'PATCH', body: JSON.stringify(body)}),
  setSelection: (id:string, body:any) => req<any>(`/campaigns/${id}/selection`, { method:'POST', body: JSON.stringify(body)}),
  preview: (id:string, customerId:string, discount?:number, templateId?:string) => {
    const sp = new URLSearchParams({ customerId });
    if (discount!==undefined) sp.set('discountPercent', String(discount));
    if (templateId) sp.set('templateId', templateId);
    return req<any>(`/campaigns/${id}/preview?${sp.toString()}`);
  },
  send: (id:string) => req<any>(`/campaigns/${id}/send`, { method:'POST' }),
  deliveries: (id:string) => req<any[]>(`/campaigns/${id}/deliveries`),
  retry: (campaignId:string, customerId:string) => req<any>(`/campaigns/${campaignId}/deliveries/${customerId}/retry`, { method:'POST' }),
  templates: () => req<any[]>('/templates'),
  createTemplate: (body:any) => req<any>('/templates', { method:'POST', body: JSON.stringify(body)}),
  bulkOptIn: (sourceId:string, value:boolean) => req<any>(`/sources/${sourceId}/bulk-opt-in`, { method:'POST', body: JSON.stringify({ value })}),
  setupStatus: () => req<any>('/setup/status'),
  testSheet: (url:string) => req<any>('/setup/test-sheet', { method:'POST', body: JSON.stringify({ url })}),
  testWhatsapp: (to?:string) => req<any>('/setup/test-whatsapp', { method:'POST', body: JSON.stringify({ to })}),
};
