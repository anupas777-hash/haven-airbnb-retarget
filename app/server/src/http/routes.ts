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

// ── Health ──
router.get('/health', (_req,res)=> res.json({ ok:true, time: new Date().toISOString(), mode: config.isDryRun() ? 'dry-run':'live' }));
