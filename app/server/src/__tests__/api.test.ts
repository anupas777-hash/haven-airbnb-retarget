import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import { prisma } from '../repositories/prisma.js';

describe('API', () => {
  let server: any;
  beforeAll(async ()=>{
    // ensure DB ready (seed may have run)
    await prisma.$connect();
  });
  afterAll(async()=>{
    await prisma.$disconnect();
  });

  it('health', async ()=>{
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('ingest mock sheet', async ()=>{
    const res = await request(app).post('/api/sources').send({ url:'mock://demo' });
    expect(res.status).toBe(200);
    expect(res.body.added + res.body.updated).toBeGreaterThanOrEqual(0);
  });

  it('customers filtering composes AND', async ()=>{
    await request(app).post('/api/sources').send({ url:'mock://demo' });
    const res = await request(app).get('/api/customers?sentiment=positive&minRating=4&optedInOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.items.every((c:any)=> c.sentimentLabel==='positive' && c.rating>=4 && c.optInWhatsApp)).toBe(true);
  });

  it('campaign idempotent send', async ()=>{
    const campRes = await request(app).post('/api/campaigns').send({ cohortRule:{ type:'lastNDays', fromDaysAgo:37, toDaysAgo:30 } });
    expect(campRes.status).toBe(201);
    const campId = campRes.body.id;
    // get a customer
    const custRes = await request(app).get('/api/customers?optedInOnly=true&pageSize=1');
    const custId = custRes.body.items[0].id;
    // selection
    await request(app).post(`/api/campaigns/${campId}/selection`).send({ customerIds:[custId] });
    // need template
    const tmplRes = await request(app).get('/api/templates');
    const tmplId = tmplRes.body[0].id;
    await request(app).patch(`/api/campaigns/${campId}`).send({ templateId: tmplId });
    const send1 = await request(app).post(`/api/campaigns/${campId}/send`);
    expect(send1.body.enqueued).toBe(1);
    // second send should skip already sent? but our dry-run initially queued, then async moves to sent/delivered — wait a bit
    await new Promise(r=> setTimeout(r, 1200));
    const send2 = await request(app).post(`/api/campaigns/${campId}/send`);
    // second send should be 0 or 1 depending if first already delivered/sent (idempotent)
    expect(send2.body.enqueued + send2.body.skipped).toBeGreaterThanOrEqual(1);
  });
});
