import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../repositories/prisma.js';
import { ingestSheet } from '../services/ingestService.js';
import { CustomerQuerySchema, IngestSourceSchema, CreateCampaignSchema, PatchCampaignSchema, SelectionSchema } from 'shared';
import { cohortMatches } from '../domain/CohortRule.js';
import { filterCustomers, createCampaign, patchCampaign, setSelection, resolveSelectionCustomerIds } from '../services/campaignService.js';
import { previewMessage, sendCampaign, retryDelivery } from '../services/messagingService.js';
import { config, COHORT_DEFAULT } from '../config/index.js';
import { getWhatsAppProvider } from '../integrations/whatsapp/index.js';
import { CompositeSheetsClient } from '../integrations/sheets/index.js';
import { CloudApiProvider } from '../integrations/whatsapp/CloudApiProvider.js';
import crypto from 'crypto';

export const router = Router();

function normalizeSheetUrl(url: string): string {
  // Extract sheetId and return canonical URL to avoid duplicates like double pasted URLs
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return `https://docs.google.com/spreadsheets/d/${m[1]}/edit`;
  return url.trim();
}

function parseMaybeJson(v:any){
  if (v==null) return null;
  if (typeof v==='string') { try { return JSON.parse(v); } catch { return v; } }
  return v;
}
function mapCampaign(c:any){
  if (!c) return c;
  return {
    ...c,
    cohortRule: parseMaybeJson(c.cohortRule),
    filtersSnapshot: parseMaybeJson(c.filtersSnapshot),
    selectedIds: parseMaybeJson(c.selectedIds),
    deselectedIds: parseMaybeJson(c.deselectedIds),
    selectionFilters: parseMaybeJson(c.selectionFilters),
    template: c.template ? { ...c.template, variables: parseMaybeJson(c.template.variables) } : c.template,
  };
}
function mapTemplate(t:any){
  if (!t) return t;
  return { ...t, variables: parseMaybeJson(t.variables) };
}
function mapSource(s:any){
  if (!s) return s;
  return { ...s, confirmedMapping: parseMaybeJson(s.confirmedMapping), detectedMapping: parseMaybeJson(s.detectedMapping) };
}

// ── Sources ──
router.post('/sources', async (req,res,next)=>{
  try {
    const parsed = IngestSourceSchema.parse(req.body);
    const normalized = normalizeSheetUrl(parsed.url);
    const result = await ingestSheet(normalized, parsed.mapping || null);
    res.json(result);
  } catch(e){ next(e); }
});

// CSV upload workaround - user can download sheet as CSV and upload
router.post('/sources/csv', async (req,res,next)=>{
  try {
    const { csvText, title, url } = req.body;
    if (!csvText || typeof csvText !== 'string') return res.status(400).json({ error:{ code:'BAD_REQUEST', message:'csvText required'}});
    // Simple CSV parse (same as PublicCsvSheetsClient)
    function parseCsv(text: string): string[][] {
      const rows: string[][] = [];
      let cur = ''; let row: string[] = []; let inQuotes = false;
      for (let i=0;i<text.length;i++) {
        const c = text[i];
        if (c === '"') { if (inQuotes && text[i+1]==='"') { cur+='"'; i++; } else inQuotes=!inQuotes; }
        else if (c===',' && !inQuotes) { row.push(cur); cur=''; }
        else if ((c==='\n' || c==='\r') && !inQuotes) { if (c==='\r' && text[i+1]==='\n') i++; row.push(cur); cur=''; if (row.some(v=>v.trim()!=='')) rows.push(row); row=[]; }
        else { cur+=c; }
      }
      if (cur!=='' || row.length>0) { row.push(cur); rows.push(row); }
      return rows.filter(r=>r.some(v=>v.trim()!==''));
    }
    const rawRows = parseCsv(csvText);
    if (rawRows.length < 1) return res.status(400).json({ error:{ code:'BAD_REQUEST', message:'Empty CSV'}});
    const headers = rawRows[0].map(h=>h.trim());
    const rows: Record<string,string>[] = rawRows.slice(1).map(r=>{
      const obj: Record<string,string> = {};
      headers.forEach((h,i)=> obj[h]= (r[i] ?? '').trim());
      return obj;
    });
    // Create a synthetic SheetData and ingest via same logic as ingestSheet but using direct data
    // We reuse ingestSheet by creating a temporary mock client override - simplest: create a SheetSource with csv data via direct service
    // For now, we create a source and manually run ingest logic using the rows
    const { detectColumnMapping, needsConfirmation } = await import('../domain/ColumnMapping.js');
    const { normalizePhone } = await import('../domain/E164Phone.js');
    const { parseDateLenient, coerceOptIn } = await import('../domain/CohortRule.js');
    const { sentimentService } = await import('../services/sentimentService.js');

    const sourceUrl = url ? normalizeSheetUrl(url) : `csv-upload://${Date.now()}`;
    let source = await prisma.sheetSource.findUnique({ where: { url: sourceUrl } });
    if (!source) {
      source = await prisma.sheetSource.create({ data: { url: sourceUrl, title: title || `CSV Upload ${new Date().toISOString().slice(0,10)}`, sheetId: sourceUrl }});
    }

    const { mapping: detected, confidence } = detectColumnMapping(headers);
    // Persist mapping
    await prisma.sheetSource.update({ where:{ id: source.id }, data:{ confirmedMapping: JSON.stringify(detected), detectedMapping: JSON.stringify(detected) }});

    let added=0, updated=0, skipped=0;
    const skippedReasons: any[] = [];
    for (let i=0;i<rows.length;i++) {
      const row = rows[i];
      const rowNum = i+2;
      try {
        const nameRaw = detected.name ? (row[detected.name] ?? '') : '';
        const phoneRaw = detected.phone ? (row[detected.phone] ?? '') : '';
        const acquiredRaw = detected.acquired_at ? (row[detected.acquired_at] ?? '') : '';
        const ratingRaw = detected.rating ? (row[detected.rating] ?? '') : '';
        const commentRaw = detected.comment ? (row[detected.comment] ?? '') : '';
        const optInRaw = detected.opt_in_whatsapp ? (row[detected.opt_in_whatsapp] ?? '') : '';
        const emailRaw = detected.email ? (row[detected.email] ?? '') : '';
        const keyAttributesRaw = (detected as any).key_attributes ? (row[(detected as any).key_attributes] ?? '') : '';

        const name = String(nameRaw).trim();
        if (!name) { skipped++; skippedReasons.push({row:rowNum, reason:'Missing name'}); continue; }

        const phoneRes = normalizePhone(String(phoneRaw));
        const acquiredAt = parseDateLenient(String(acquiredRaw));
        let rating: number | null = null;
        if (ratingRaw !== '' && ratingRaw != null) {
          const n = parseInt(String(ratingRaw),10);
          if (!isNaN(n) && n>=1 && n<=5) rating=n;
        }
        const comment = String(commentRaw).trim() || null;
        const optIn = detected.opt_in_whatsapp ? coerceOptIn(optInRaw) : false;
        const email = String(emailRaw).trim() || null;
        const keyAttributes = String(keyAttributesRaw).trim() || null;
        const sentiment = sentimentService.analyze(comment);
        const sheetRowKey = `${source.id}:${(phoneRes.e164||String(phoneRaw).replace(/\D/g,''))}:${String(acquiredRaw)}:${i}`;

        let existing = await prisma.customer.findUnique({ where:{ sheetRowKey }});
        const dataToSave = {
          name, phoneRaw: String(phoneRaw), phoneE164: phoneRes.e164, phoneValid: phoneRes.valid,
          acquiredAt, acquiredAtRaw: String(acquiredRaw) || null, rating, comment,
          sentimentLabel: sentiment.label, sentimentScore: sentiment.score, sentimentHash: sentiment.hash,
          optInWhatsApp: optIn, email, keyAttributes, sourceId: source.id,
        };
        if (existing) {
          await prisma.customer.update({ where:{ id: existing.id }, data: dataToSave });
          updated++;
        } else {
          await prisma.customer.create({ data: { ...dataToSave, sheetRowKey }});
          added++;
        }
      } catch (e:any) {
        skipped++; skippedReasons.push({row:rowNum, reason: e.message});
      }
    }
    await prisma.sheetSource.update({ where:{ id: source.id }, data:{ lastSyncedAt: new Date() }});
    res.json({ added, updated, skipped, skippedReasons: skippedReasons.slice(0,20), detectedMapping: detected, confidence, needsConfirmation:false, sourceId: source.id, title: source.title });
  } catch(e){ next(e); }
});

router.get('/sources', async (_req,res,next)=>{
  try {
    const sources = await prisma.sheetSource.findMany({ orderBy:{ updatedAt:'desc' }});
    res.json(sources.map(mapSource));
  } catch(e){ next(e); }
});

router.get('/sources/:id/mapping', async (req,res,next)=>{
  try {
    const s = await prisma.sheetSource.findUnique({ where:{ id:req.params.id }});
    if (!s) return res.status(404).json({ error:{ code:'NOT_FOUND', message:'Source not found'}});
    res.json({ confirmedMapping: parseMaybeJson(s.confirmedMapping), detectedMapping: parseMaybeJson(s.detectedMapping), title: s.title, url: s.url });
  } catch(e){ next(e); }
});

router.put('/sources/:id/mapping', async (req,res,next)=>{
  try {
    // body: { mapping: ColumnMapping, url?: string for re-ingest }
    const mapping = req.body.mapping;
    const s = await prisma.sheetSource.findUnique({ where:{ id:req.params.id }});
    if (!s) return res.status(404).json({ error:{ code:'NOT_FOUND', message:'Source not found'}});
    // persist and re-ingest
    const result = await ingestSheet(s.url, mapping);
    res.json(result);
  } catch(e){ next(e); }
});

router.post('/sources/:id/bulk-opt-in', async (req,res,next)=>{
  try {
    const { value } = req.body; // true/false, default true if missing
    const optIn = value === undefined ? true : !!value;
    const source = await prisma.sheetSource.findUnique({ where:{ id:req.params.id }});
    if (!source) return res.status(404).json({ error:{ code:'NOT_FOUND', message:'Source not found'}});
    const updated = await prisma.customer.updateMany({ where:{ sourceId: req.params.id }, data:{ optInWhatsApp: optIn }});
    res.json({ ok:true, count: updated.count, optIn });
  } catch(e){ next(e); }
});

router.post('/sync', async (req,res,next)=>{
  try {
    const { sourceId, url } = req.body;
    let sourceUrl = url ? normalizeSheetUrl(url) : url;
    if (sourceId) {
      const s = await prisma.sheetSource.findUnique({ where:{ id: sourceId }});
      if (!s) return res.status(404).json({ error:{ code:'NOT_FOUND', message:'Source not found'}});
      sourceUrl = s.url;
    }
    if (!sourceUrl) return res.status(400).json({ error:{ code:'BAD_REQUEST', message:'url or sourceId required'}});
    const result = await ingestSheet(sourceUrl);
    res.json(result);
  } catch(e){ next(e); }
});

// ── Customers ──
router.get('/customers', async (req,res,next)=>{
  try {
    const q = CustomerQuerySchema.parse(req.query);
    // Determine cohort rule - previous guests
    let cohortRule: any = null;
    if (q.campaignId) {
      const camp = await prisma.campaign.findUnique({ where:{ id: q.campaignId }});
      if (camp) cohortRule = parseMaybeJson(camp.cohortRule);
    } else if (q.from || q.to) {
      cohortRule = { type:'customRange', from: q.from ? new Date(q.from).toISOString(): undefined, to: q.to ? new Date(q.to).toISOString(): undefined };
    } else if (q.acquiredFromDays!==undefined || q.acquiredToDays!==undefined) {
      if (q.acquiredFromDays!==undefined && q.acquiredToDays!==undefined) {
        cohortRule = { type:'lastNDays', fromDaysAgo: q.acquiredToDays, toDaysAgo: q.acquiredFromDays };
      } else if (q.acquiredFromDays!==undefined) {
        cohortRule = { type:'lastNDays', days: q.acquiredFromDays };
      }
    } else {
      cohortRule = null;
    }

    // Build Prisma where for cohort (push to SQL) + rating/sentiment
    const where: any = {};
    if (cohortRule) {
      if (cohortRule.type === 'customRange') {
        if (cohortRule.from) where.acquiredAt = { ...(where.acquiredAt||{}), gte: new Date(cohortRule.from) };
        if (cohortRule.to) {
          const to = new Date(cohortRule.to);
          to.setHours(23,59,59,999);
          where.acquiredAt = { ...(where.acquiredAt||{}), lte: to };
        }
      } else if (cohortRule.type === 'lastNDays') {
        if (cohortRule.fromDaysAgo !== undefined && cohortRule.toDaysAgo !== undefined) {
          const from = new Date(); from.setHours(0,0,0,0); from.setDate(from.getDate() - Math.max(cohortRule.fromDaysAgo, cohortRule.toDaysAgo));
          const to = new Date(); to.setHours(23,59,59,999); to.setDate(to.getDate() - Math.min(cohortRule.fromDaysAgo, cohortRule.toDaysAgo));
          where.acquiredAt = { gte: from, lte: to };
        } else if (cohortRule.days) {
          const from = new Date(); from.setHours(0,0,0,0); from.setDate(from.getDate() - cohortRule.days);
          where.acquiredAt = { gte: from };
        }
      }
    }
    if (q.minRating !== undefined) where.rating = { ...(where.rating||{}), gte: q.minRating };
    if (q.maxRating !== undefined) where.rating = { ...(where.rating||{}), lte: q.maxRating };
    if (q.sentiment && (q.sentiment as string[]).length) where.sentimentLabel = { in: q.sentiment as string[] };

    // Search still needs JS for keyAttributes (not indexed) - fetch with where then filter
    let customers = await prisma.customer.findMany({ where, orderBy: [{ acquiredAt: 'desc' }, { name:'asc' }] });

    // Compute repeat counts from all customers (for accurate stays)
    const allForRepeat = await prisma.customer.findMany({ select: { phoneE164: true, phoneRaw: true, name: true } });
    const repeatMap = new Map<string, number>();
    for (const c of allForRepeat) {
      const key = c.phoneE164 || c.phoneRaw.replace(/\D/g,'') || c.name.toLowerCase().trim();
      repeatMap.set(key, (repeatMap.get(key) || 0) + 1);
    }
    // Apply filters
    const filtered = customers.filter(c=>{
      if (cohortRule && !cohortMatches(c.acquiredAt, cohortRule)) return false;
      if (q.optedInOnly && !c.optInWhatsApp) return false;
      if (q.minRating!==undefined && (c.rating==null || c.rating < q.minRating)) return false;
      if (q.maxRating!==undefined && (c.rating==null || c.rating > q.maxRating)) return false;
      if (q.sentiment && (q.sentiment as string[]).length && !(q.sentiment as string[]).includes(c.sentimentLabel)) return false;
      if (q.search) {
        const s = q.search.toLowerCase();
        if (!c.name.toLowerCase().includes(s) && !(c.comment||'').toLowerCase().includes(s) && !(c.phoneRaw||'').toLowerCase().includes(s) && !(c.email||'').toLowerCase().includes(s) && !((c as any).keyAttributes||'').toLowerCase().includes(s)) return false;
      }
      return true;
    });

    // Sorting
    if (q.sort) {
      const [field, dir] = q.sort.split(':');
      filtered.sort((a,b)=>{
        const av = (a as any)[field]; const bv=(b as any)[field];
        if (av==null && bv==null) return 0;
        if (av==null) return 1;
        if (bv==null) return -1;
        if (av < bv) return dir==='asc'? -1:1;
        if (av > bv) return dir==='asc'? 1:-1;
        return 0;
      });
    }

    const total = filtered.length;
    const start = (q.page-1)*q.pageSize;
    const pageItems = filtered.slice(start, start+q.pageSize);

    // Stats - previous guests (from all, not filtered)
    const allForStats = await prisma.customer.findMany();
    const excludedBadPhone = allForStats.filter(c=>!c.phoneValid).length;
    const excludedBadDate = allForStats.filter(c=>!c.acquiredAt).length;

    res.json({
      items: pageItems.map(c=> {
        const key = c.phoneE164 || c.phoneRaw.replace(/\D/g,'') || c.name.toLowerCase().trim();
        const repeatCount = repeatMap.get(key) || 1;
        return {
          ...c,
          phoneMasked: c.phoneE164 ? c.phoneE164.slice(0,-4).replace(/./g,'•')+c.phoneE164.slice(-4) : '—',
          repeatCount,
        };
      }),
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.ceil(total/q.pageSize),
      stats: { excludedBadPhone, excludedBadDate },
      cohortRule,
    });
  } catch(e){ next(e); }
});

// ── Campaigns ──
router.post('/campaigns', async (req,res,next)=>{
  try {
    const parsed = CreateCampaignSchema.parse(req.body);
    const camp = await createCampaign(parsed);
    res.status(201).json(mapCampaign(camp));
  } catch(e){ next(e); }
});

router.get('/campaigns', async (_req,res,next)=>{
  try {
    const camps = await prisma.campaign.findMany({ orderBy:{ updatedAt:'desc' }, include:{ template:true }});
    res.json(camps.map(mapCampaign));
  } catch(e){ next(e); }
});

router.get('/campaigns/:id', async (req,res,next)=>{
  try {
    const c = await prisma.campaign.findUnique({ where:{ id:req.params.id }, include:{ template:true, deliveries:true }});
    if (!c) return res.status(404).json({ error:{ code:'NOT_FOUND', message:'Campaign not found'}});
    res.json(mapCampaign(c));
  } catch(e){ next(e); }
});

router.patch('/campaigns/:id', async (req,res,next)=>{
  try {
    const parsed = PatchCampaignSchema.parse(req.body);
    const c = await patchCampaign(req.params.id, parsed);
    res.json(mapCampaign(c));
  } catch(e){ next(e); }
});

router.post('/campaigns/:id/selection', async (req,res,next)=>{
  try {
    const parsed = SelectionSchema.parse(req.body);
    const c = await setSelection(req.params.id, parsed);
    res.json(mapCampaign(c));
  } catch(e){ next(e); }
});

router.get('/campaigns/:id/preview', async (req,res,next)=>{
  try {
    const campaignRaw = await prisma.campaign.findUnique({ where:{ id:req.params.id }, include:{ template:true }});
    if (!campaignRaw) return res.status(404).json({ error:{ code:'NOT_FOUND', message:'Campaign not found'}});
    const campaign = mapCampaign(campaignRaw);
    const customerId = req.query.customerId as string;
    const discountOverride = req.query.discountPercent ? parseInt(req.query.discountPercent as string,10) : campaign.discountPercent;
    const templateId = req.query.templateId as string | undefined;
    let templateBody = (campaign.template as any)?.body;
    if (templateId) {
      const t = await prisma.messageTemplate.findUnique({ where:{ id: templateId }});
      if (t) templateBody = t.body;
    }
    if (!templateBody) templateBody = `Hi {{name}} — we miss you at ${config.brandName}! Here's {{discount}} off your next visit.`;
    if (!customerId) return res.status(400).json({ error:{ code:'BAD_REQUEST', message:'customerId required'}});
    const customer = await prisma.customer.findUnique({ where:{ id: customerId }});
    if (!customer) return res.status(404).json({ error:{ code:'NOT_FOUND', message:'Customer not found'}});
    const rendered = previewMessage(templateBody, customer, discountOverride, config.brandName);
    // validation: missing variables?
    const missing: string[] = [];
    if (!customer.name) missing.push('name');
    res.json({ rendered, body: templateBody, customer: { id: customer.id, name: customer.name, phoneMasked: customer.phoneE164 ? '••••'+customer.phoneE164.slice(-4): '—' }, discountPercent: discountOverride, missing });
  } catch(e){ next(e); }
});

router.post('/campaigns/:id/send', async (req,res,next)=>{
  try {
    const result = await sendCampaign(req.params.id, config.brandName);
    res.json(result);
  } catch(e){ next(e); }
});

router.get('/campaigns/:id/deliveries', async (req,res,next)=>{
  try {
    const dels = await prisma.delivery.findMany({ where:{ campaignId:req.params.id }, include:{ customer:true }, orderBy:{ updatedAt:'desc' }});
    res.json(dels.map(d=> ({
      ...d,
      customer: d.customer ? { id: d.customer.id, name: d.customer.name, phoneMasked: d.customer.phoneE164 ? '••••'+d.customer.phoneE164.slice(-4): d.customer.phoneRaw, phoneE164: d.customer.phoneE164 } : null
    })));
  } catch(e){ next(e); }
});

router.post('/campaigns/:id/deliveries/:customerId/retry', async (req,res,next)=>{
  try {
    const r = await retryDelivery(req.params.id, req.params.customerId, config.brandName);
    res.json(r);
  } catch(e){ next(e); }
});

// ── Templates ──
router.get('/templates', async (_req,res,next)=>{
  try {
    const t = await prisma.messageTemplate.findMany({ orderBy:{ updatedAt:'desc' }});
    res.json(t.map(mapTemplate));
  } catch(e){ next(e); }
});

router.post('/templates', async (req,res,next)=>{
  try {
    const { name, body, variables, whatsappTemplateName, locale, status } = req.body;
    if (!name || !body) return res.status(400).json({ error:{ code:'BAD_REQUEST', message:'name and body required'}});
    const created = await prisma.messageTemplate.create({ data:{
      name, body, variables: JSON.stringify(variables || [{key:'1', mappedTo:'name'},{key:'2', mappedTo:'discount'}]),
      whatsappTemplateName: whatsappTemplateName || null,
      locale: locale || 'en_US',
      status: status || 'draft',
    }});
    res.status(201).json(mapTemplate(created));
  } catch(e){ next(e); }
});

router.delete('/templates/:id', async (req,res,next)=>{
  try {
    await prisma.messageTemplate.delete({ where:{ id: req.params.id }});
    res.json({ ok:true });
  } catch(e){ next(e); }
});

// ── Setup / Go-live wizard ──
router.get('/setup/status', async (_req,res)=>{
  const saEmail = config.google.serviceAccountEmail || null;
  const whatsappConfigured = !!config.whatsapp.phoneNumberId && !!config.whatsapp.accessToken;
  // we don't store lastTest; for now null
  res.json({
    mode: config.isDryRun() ? 'dry-run' : 'live',
    sheet: { configured: config.isSheetServiceAccountConfigured(), canReadPublic: true, serviceAccountEmail: saEmail, lastTest: null, lastError: null },
    whatsapp: { configured: whatsappConfigured, canSend: whatsappConfigured, phoneNumberId: whatsappConfigured ? config.whatsapp.phoneNumberId : null, lastTest: null, lastError: null },
    brandName: config.brandName,
    defaultDiscountPercent: config.defaultDiscountPercent,
  });
});

router.post('/setup/test-sheet', async (req,res,next)=>{
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error:{ code:'BAD_REQUEST', message:'url required'}});
    const client = new CompositeSheetsClient();
    const r = await client.testConnection(url);
    if (r.ok) return res.json({ ok:true, title: r.title });
    return res.status(422).json({ ok:false, error: r.error });
  } catch(e){ next(e); }
});

router.post('/setup/test-whatsapp', async (req,res)=>{
  const provider = getWhatsAppProvider();
  if (provider.name==='console') {
    // In dry-run, simulate test
    const { to } = req.body;
    if (to) {
      // try console send
      await provider.sendTemplate({ toE164: to, templateName:'hello_world', locale:'en_US', variables:[], customerId:'test', campaignId:'test' });
    }
    return res.json({ ok:true, mode:'dry-run', message:'Dry-run: message simulated (no real WhatsApp). Configure WHATSAPP_* env to go live.' });
  }
  // live path: try to fetch phone number info
  try {
    const url = `https://graph.facebook.com/v21.0/${config.whatsapp.phoneNumberId}?fields=verified_name,code_verification_status,display_phone_number,quality_rating`;
    const resp = await fetch(url, { headers:{ Authorization:`Bearer ${config.whatsapp.accessToken}` }});
    const json:any = await resp.json();
    if (!resp.ok) return res.status(422).json({ ok:false, error: json?.error?.message || `HTTP ${resp.status}`, details: json });
    return res.json({ ok:true, mode:'live', details: json });
  } catch (e:any) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// ── Webhooks WhatsApp ──
router.get('/webhooks/whatsapp', (req,res)=>{
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;
  const provider: any = getWhatsAppProvider();
  const result = provider.verifyWebhook ? provider.verifyWebhook(mode, token, challenge) : { ok: mode==='subscribe' && token===config.whatsapp.verifyToken, challenge };
  if (result.ok) return res.status(200).send(result.challenge || challenge);
  return res.sendStatus(403);
});

router.post('/webhooks/whatsapp', async (req,res,next)=>{
  try {
    // Verify signature if CloudApiProvider
    const provider: any = getWhatsAppProvider();
    if (provider instanceof CloudApiProvider) {
      const rawBody = JSON.stringify(req.body);
      const sig = req.headers['x-hub-signature-256'] as string | undefined;
      if (config.whatsapp.appSecret && sig && !provider.verifySignature(rawBody, sig)) {
        return res.status(401).json({ error:{ code:'INVALID_SIGNATURE', message:'Webhook signature mismatch' }});
      }
      await provider.handleStatusWebhook(req.body);
    } else if (provider.handleStatusWebhook) {
      await provider.handleStatusWebhook(req.body);
    }
    res.sendStatus(200);
  } catch(e){ next(e); }
});

// ── Multi-Property OS - Properties ──
router.get('/properties', async (_req, res, next) => {
  try {
    const props = await prisma.property.findMany({ orderBy: { city: 'asc' } });
    // Add counts
    const result = await Promise.all(props.map(async (p: any) => {
      const revCount = await prisma.revenue.count({ where: { propertyId: p.id } });
      const expCount = await prisma.expense.count({ where: { propertyId: p.id } });
      const custCount = await prisma.customer.count({ where: { propertyId: p.id } });
      return { ...p, _count: { revenues: revCount, expenses: expCount, customers: custCount } };
    }));
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/properties', async (req, res, next) => {
  try {
    const { name, city, country, address, airbnbListingId, airbnbUrl, type, bedrooms, beds, status, sheetUrl, color } = req.body;
    if (!name || !city) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'name and city required' } });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
    const prop = await prisma.property.create({
      data: {
        name, city, country: country || 'India', address, airbnbListingId, airbnbUrl, type,
        bedrooms: bedrooms ? parseInt(bedrooms) : null,
        beds: beds ? parseInt(beds) : null,
        status: status || 'active',
        sheetUrl, slug, color,
      }
    });
    res.status(201).json(prop);
  } catch (e) { next(e); }
});

router.get('/properties/:id', async (req, res, next) => {
  try {
    const prop = await prisma.property.findUnique({ where: { id: req.params.id } });
    if (!prop) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Property not found' } });
    const revenues = await prisma.revenue.findMany({ where: { propertyId: prop.id }, orderBy: { date: 'desc' }, take: 20 });
    const expenses = await prisma.expense.findMany({ where: { propertyId: prop.id }, orderBy: { date: 'desc' }, take: 20 });
    res.json({ ...prop, recentRevenues: revenues, recentExpenses: expenses });
  } catch (e) { next(e); }
});

router.patch('/properties/:id', async (req, res, next) => {
  try {
    const prop = await prisma.property.update({ where: { id: req.params.id }, data: req.body });
    res.json(prop);
  } catch (e) { next(e); }
});

router.delete('/properties/:id', async (req, res, next) => {
  try {
    await prisma.property.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/cities', async (_req, res, next) => {
  try {
    const props = await prisma.property.findMany();
    const cities = [...new Set(props.map((p: any) => p.city))].filter(Boolean).sort();
    const result = cities.map(city => {
      const cityProps = props.filter((p: any) => p.city === city);
      return { city, propertyCount: cityProps.length, properties: cityProps.map((p: any) => ({ id: p.id, name: p.name, slug: p.slug })) };
    });
    res.json(result);
  } catch (e) { next(e); }
});

// ── Revenue ──
router.get('/revenues', async (req, res, next) => {
  try {
    const { propertyId, city, from, to, search, page = 1, pageSize = 50, sort = 'date:desc' } = req.query as any;
    let revenues = await prisma.revenue.findMany({ include: { property: true }, orderBy: { date: 'desc' } });
    const properties = await prisma.property.findMany();

    // Apply filters
    if (propertyId) revenues = revenues.filter((r: any) => r.propertyId === propertyId);
    if (city) {
      const propMap = new Map(properties.map((p: any) => [p.id, p]));
      revenues = revenues.filter((r: any) => {
        const prop = propMap.get(r.propertyId);
        return prop && prop.city === city;
      });
    }
    if (from) {
      const fromDate = new Date(from);
      revenues = revenues.filter((r: any) => new Date(r.date) >= fromDate);
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      revenues = revenues.filter((r: any) => new Date(r.date) <= toDate);
    }
    if (search) {
      const s = String(search).toLowerCase();
      revenues = revenues.filter((r: any) =>
        String(r.guestName || '').toLowerCase().includes(s) ||
        String(r.bookingId || '').toLowerCase().includes(s) ||
        String(r.room || '').toLowerCase().includes(s) ||
        String(r.property?.name || '').toLowerCase().includes(s)
      );
    }

    // Sorting
    if (sort) {
      const [field, dir] = String(sort).split(':');
      revenues.sort((a: any, b: any) => {
        const av = a[field]; const bv = b[field];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    const total = revenues.length;
    const p = parseInt(page); const ps = parseInt(pageSize);
    const start = (p - 1) * ps;
    const items = revenues.slice(start, start + ps);

    res.json({ items, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) });
  } catch (e) { next(e); }
});

router.post('/revenues', async (req, res, next) => {
  try {
    const { propertyId, date, bookingId, guestName, checkIn, checkOut, nights, room, baseAmount, cleaningFee, taxes, discount, platformFee, payout, netRevenue, notes, channel, status } = req.body;
    if (!propertyId || !date) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'propertyId and date required' } });
    const prop = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!prop) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Property not found' } });

    const parsedDate = new Date(date);
    const sheetRowKey = `${propertyId}:manual:rev:${Date.now()}:${Math.random().toString(36).slice(2,8)}`;

    const rev = await prisma.revenue.create({
      data: {
        propertyId, date: parsedDate, dateRaw: String(date), bookingId, guestName, checkIn: checkIn ? new Date(checkIn) : null,
        checkOut: checkOut ? new Date(checkOut) : null, nights: nights ? parseInt(nights) : null, room,
        baseAmount: baseAmount ? parseFloat(baseAmount) : null, cleaningFee: cleaningFee ? parseFloat(cleaningFee) : null,
        taxes: taxes ? parseFloat(taxes) : null, discount: discount ? parseFloat(discount) : null,
        platformFee: platformFee ? parseFloat(platformFee) : null, payout: payout ? parseFloat(payout) : null,
        netRevenue: netRevenue ? parseFloat(netRevenue) : (payout ? parseFloat(payout) : (baseAmount ? parseFloat(baseAmount) : null)),
        notes, channel: channel || 'airbnb', status: status || 'confirmed', sheetRowKey, source: 'manual',
      }
    });
    res.status(201).json(rev);
  } catch (e) { next(e); }
});

router.patch('/revenues/:id', async (req, res, next) => {
  try {
    const rev = await prisma.revenue.update({ where: { id: req.params.id }, data: req.body });
    res.json(rev);
  } catch (e) { next(e); }
});

router.delete('/revenues/:id', async (req, res, next) => {
  try {
    await prisma.revenue.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Expenses ──
router.get('/expenses', async (req, res, next) => {
  try {
    const { propertyId, city, category, from, to, search, page = 1, pageSize = 50, sort = 'date:desc' } = req.query as any;
    let expenses = await prisma.expense.findMany({ include: { property: true }, orderBy: { date: 'desc' } });
    const properties = await prisma.property.findMany();

    if (propertyId) expenses = expenses.filter((e: any) => e.propertyId === propertyId);
    if (city) {
      const propMap = new Map(properties.map((p: any) => [p.id, p]));
      expenses = expenses.filter((e: any) => {
        const prop = propMap.get(e.propertyId);
        return prop && prop.city === city;
      });
    }
    if (category) expenses = expenses.filter((e: any) => e.category === category);
    if (from) {
      const fromDate = new Date(from);
      expenses = expenses.filter((e: any) => new Date(e.date) >= fromDate);
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      expenses = expenses.filter((e: any) => new Date(e.date) <= toDate);
    }
    if (search) {
      const s = String(search).toLowerCase();
      expenses = expenses.filter((e: any) =>
        String(e.category || '').toLowerCase().includes(s) ||
        String(e.vendor || '').toLowerCase().includes(s) ||
        String(e.notes || '').toLowerCase().includes(s)
      );
    }

    if (sort) {
      const [field, dir] = String(sort).split(':');
      expenses.sort((a: any, b: any) => {
        const av = a[field]; const bv = b[field];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    const total = expenses.length;
    const p = parseInt(page); const ps = parseInt(pageSize);
    const start = (p - 1) * ps;
    const items = expenses.slice(start, start + ps);

    res.json({ items, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) });
  } catch (e) { next(e); }
});

router.post('/expenses', async (req, res, next) => {
  try {
    const { propertyId, date, category, subcategory, vendor, amount, currency, paymentMethod, recurring, notes } = req.body;
    if (!propertyId || !date || !amount) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'propertyId, date, amount required' } });
    const prop = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!prop) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Property not found' } });

    const sheetRowKey = `${propertyId}:manual:exp:${Date.now()}:${Math.random().toString(36).slice(2,8)}`;

    const exp = await prisma.expense.create({
      data: {
        propertyId, date: new Date(date), dateRaw: String(date), category: category || 'Other', subcategory,
        vendor, amount: parseFloat(amount), currency: currency || 'INR', paymentMethod,
        recurring: !!recurring, notes, sheetRowKey, source: 'manual',
      }
    });
    res.status(201).json(exp);
  } catch (e) { next(e); }
});

router.patch('/expenses/:id', async (req, res, next) => {
  try {
    const exp = await prisma.expense.update({ where: { id: req.params.id }, data: req.body });
    res.json(exp);
  } catch (e) { next(e); }
});

router.delete('/expenses/:id', async (req, res, next) => {
  try {
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/expenses/categories', async (_req, res, next) => {
  try {
    const expenses = await prisma.expense.findMany();
    const cats = [...new Set(expenses.map((e: any) => e.category).filter(Boolean))].sort();
    res.json(cats);
  } catch (e) { next(e); }
});

// ── Reports / P&L / Dashboard ──
router.get('/reports/pnl', async (req, res, next) => {
  try {
    const { city, propertyId, from, to } = req.query as any;
    const { getPnLReport } = await import('../services/reportService.js');
    const filters: any = {};
    if (city) filters.city = city;
    if (propertyId) filters.propertyId = propertyId;
    if (from) filters.from = new Date(from);
    if (to) { const d = new Date(to); d.setHours(23,59,59,999); filters.to = d; }
    const report = await getPnLReport(filters);
    res.json(report);
  } catch (e) { next(e); }
});

router.get('/reports/dashboard', async (req, res, next) => {
  try {
    const { city, propertyId, from, to } = req.query as any;
    const { getDashboardMetrics } = await import('../services/reportService.js');
    const filters: any = {};
    if (city) filters.city = city;
    if (propertyId) filters.propertyId = propertyId;
    if (from) filters.from = new Date(from);
    if (to) { const d = new Date(to); d.setHours(23,59,59,999); filters.to = d; }
    const metrics = await getDashboardMetrics(filters);
    res.json(metrics);
  } catch (e) { next(e); }
});

router.get('/reports/property/:id', async (req, res, next) => {
  try {
    const { from, to } = req.query as any;
    const { getPnLReport, getDashboardMetrics } = await import('../services/reportService.js');
    const filters: any = { propertyId: req.params.id };
    if (from) filters.from = new Date(from);
    if (to) { const d = new Date(to); d.setHours(23,59,59,999); filters.to = d; }
    const pnl = await getPnLReport(filters);
    const dash = await getDashboardMetrics(filters);
    const prop = await prisma.property.findUnique({ where: { id: req.params.id } });
    res.json({ property: prop, pnl, dashboard: dash });
  } catch (e) { next(e); }
});

router.get('/reports/city/:city', async (req, res, next) => {
  try {
    const { from, to } = req.query as any;
    const { getPnLReport, getDashboardMetrics } = await import('../services/reportService.js');
    const filters: any = { city: req.params.city };
    if (from) filters.from = new Date(from);
    if (to) { const d = new Date(to); d.setHours(23,59,59,999); filters.to = d; }
    const pnl = await getPnLReport(filters);
    const dash = await getDashboardMetrics(filters);
    res.json({ city: req.params.city, pnl, dashboard: dash });
  } catch (e) { next(e); }
});

// ── Local XLSX ingestion from data folder ──
router.post('/ingest/xlsx', async (req, res, next) => {
  try {
    const { filePath, propertyId } = req.body;
    const { ingestXlsxFile, ingestAllXlsxFromDataFolder } = await import('../services/xlsxService.js');
    if (filePath) {
      const result = await ingestXlsxFile(filePath, propertyId);
      res.json(result);
    } else {
      const result = await ingestAllXlsxFromDataFolder();
      res.json(result);
    }
  } catch (e) { next(e); }
});

// ── Health ──
router.get('/health', (_req,res)=> res.json({ ok:true, time: new Date().toISOString(), mode: config.isDryRun() ? 'dry-run':'live' }));
