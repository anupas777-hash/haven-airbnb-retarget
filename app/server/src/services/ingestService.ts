import { prisma } from '../repositories/prisma.js';
import { detectColumnMapping, needsConfirmation } from '../domain/ColumnMapping.js';
import { normalizePhone } from '../domain/E164Phone.js';
import { parseDateLenient, coerceOptIn } from '../domain/CohortRule.js';
import { sentimentService } from './sentimentService.js';
import { CompositeSheetsClient } from '../integrations/sheets/index.js';
import type { ColumnMapping } from 'shared';

type SyncSummary = {
  added: number;
  updated: number;
  skipped: number;
  skippedReasons: Array<{ row: number; reason: string }>;
  detectedMapping: ColumnMapping;
  confidence: Record<string, number>;
  needsConfirmation: boolean;
  sourceId: string;
  title: string;
};

function normalizeForKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g,'').replace(/[^a-z0-9]/g,'');
}
function stableRowKey(sheetId: string, rowIndex: number, phoneRaw: string, name: string, emailRaw: string, phoneE164: string | null, acquiredAtRaw: string | null): string {
  // Keep each stay separate: same guest with multiple stays should be separate rows
  // Use phone+date+rowIndex for stability, fallback to old phone+name for migration
  const phoneKey = phoneE164 ? phoneE164.replace('+','') : String(phoneRaw).replace(/\D/g,'');
  const nameKey = normalizeForKey(name);
  const emailKey = normalizeForKey(emailRaw);
  const dateKey = normalizeForKey(String(acquiredAtRaw || ''));
  if (phoneKey && phoneKey.length >= 7 && dateKey) return `${sheetId}:${phoneKey}:${dateKey}:${rowIndex}`;
  if (phoneKey && phoneKey.length >= 7) return `${sheetId}:${phoneKey}:${rowIndex}`;
  if (emailKey && emailKey.length >= 5 && dateKey) return `${sheetId}:${emailKey}:${dateKey}:${rowIndex}`;
  if ((phoneKey || emailKey) && nameKey.length >= 2) return `${sheetId}:${phoneKey || emailKey}:${nameKey}:${rowIndex}`;
  if (phoneKey && phoneKey.length >= 7) return `${sheetId}:${phoneKey}:${rowIndex}`;
  if (emailKey && emailKey.length >= 5) return `${sheetId}:${emailKey}:${rowIndex}`;
  return `${sheetId}:row:${rowIndex}`;
}

export async function ingestSheet(url: string, confirmedMapping?: ColumnMapping | null): Promise<SyncSummary & { mappingToConfirm?: ColumnMapping }> {
  const client = new CompositeSheetsClient();
  let data;
  try {
    data = await client.fetchSheet(url);
  } catch (e:any) {
    throw { code: 'SHEET_NOT_READABLE', message: e.message || 'Could not read sheet', details: { url } };
  }

  const sheetId = url; // use url as stable key; could extract id but keep url
  // Find or create SheetSource
  let source = await prisma.sheetSource.findUnique({ where: { url } });
  if (!source) {
    source = await prisma.sheetSource.create({ data: { url, title: data.title, sheetId: url }});
  } else if (data.title && source.title !== data.title) {
    source = await prisma.sheetSource.update({ where:{ id: source.id }, data:{ title: data.title }});
  }

  const headers = data.headers;
  const { mapping: detected, confidence } = detectColumnMapping(headers);
  // parse stored string mappings
  const parsedConfirmed = source.confirmedMapping ? safeParse(source.confirmedMapping as any) as ColumnMapping | null : null;
  const mapping: ColumnMapping = confirmedMapping || parsedConfirmed || detected;
  const needsConfirm = !confirmedMapping && !(parsedConfirmed) && needsConfirmation(detected, confidence as any);

  // If needs confirmation and no confirmed mapping, return early without upserting? But spec says auto-map and continue unless required missing.
  // So if needsConfirmation true, we should still not ingest until confirmed? Spec 6.2: If required field can't be confidently matched, show mapping screen.
  // We'll return summary with needsConfirmation true and not upsert.
  if (needsConfirm) {
    return {
      added: 0, updated:0, skipped: data.rows.length,
      skippedReasons: [{ row: 0, reason: 'Column mapping needs confirmation' }],
      detectedMapping: detected, confidence: confidence as any, needsConfirmation: true, sourceId: source.id, title: data.title,
    };
  }

  // Validate required mapping present
  const requiredOk = mapping.name && mapping.phone && mapping.acquired_at;
  if (!requiredOk) {
    return {
      added:0, updated:0, skipped: data.rows.length,
      skippedReasons: [{ row:0, reason: 'Required columns (name, phone, acquired_at) not mapped'}],
      detectedMapping: mapping, confidence: confidence as any, needsConfirmation: true, sourceId: source.id, title: data.title,
    };
  }

  // Persist confirmed mapping if newly confirmed
  if (confirmedMapping) {
    await prisma.sheetSource.update({ where:{ id: source.id }, data:{ confirmedMapping: JSON.stringify(confirmedMapping), detectedMapping: JSON.stringify(detected) }});
  } else if (!source.confirmedMapping && !needsConfirm) {
    // auto-persist detected as confirmed since high confidence
    await prisma.sheetSource.update({ where:{ id: source.id }, data:{ confirmedMapping: JSON.stringify(detected), detectedMapping: JSON.stringify(detected) }});
  } else if (!source.detectedMapping) {
    await prisma.sheetSource.update({ where:{ id: source.id }, data:{ detectedMapping: JSON.stringify(detected) }});
  }

  let added=0, updated=0, skipped=0;
  const skippedReasons: Array<{row:number; reason:string}> = [];

  for (let i=0;i<data.rows.length;i++) {
    const row = data.rows[i];
    const rowNum = i+2; // 1-indexed header +1
    try {
      const nameRaw = mapping.name ? (row[mapping.name] ?? '') : '';
      const phoneRaw = mapping.phone ? (row[mapping.phone] ?? '') : '';
      const acquiredRaw = mapping.acquired_at ? (row[mapping.acquired_at] ?? '') : '';
      const ratingRaw = mapping.rating ? (row[mapping.rating] ?? '') : '';
      const commentRaw = mapping.comment ? (row[mapping.comment] ?? '') : '';
      const optInRaw = mapping.opt_in_whatsapp ? (row[mapping.opt_in_whatsapp] ?? '') : '';
      const emailRaw = mapping.email ? (row[mapping.email] ?? '') : '';
      const keyAttributesRaw = (mapping as any).key_attributes ? (row[(mapping as any).key_attributes] ?? '') : '';

      const name = String(nameRaw).trim();
      if (!name) { skipped++; skippedReasons.push({row:rowNum, reason:'Missing name'}); continue; }

      // Phone normalization
      const phoneRes = normalizePhone(String(phoneRaw));
      // Acquired date
      const acquiredAt = parseDateLenient(String(acquiredRaw));
      // Rating
      let rating: number | null = null;
      if (ratingRaw !== '' && ratingRaw != null) {
        const n = parseInt(String(ratingRaw),10);
        if (!isNaN(n) && n>=1 && n<=5) rating=n;
        else if (String(ratingRaw).trim()!=='') {
          // try float
          const f = parseFloat(String(ratingRaw));
          if (!isNaN(f)) rating = Math.min(5, Math.max(1, Math.round(f)));
        }
      }
      const comment = String(commentRaw).trim() || null;
      const optIn = mapping.opt_in_whatsapp ? coerceOptIn(optInRaw) : false;
      const email = String(emailRaw).trim() || null;
      const keyAttributes = String(keyAttributesRaw).trim() || null;

      // Sentiment
      const sentiment = sentimentService.analyze(comment);

      const rowKey = stableRowKey(source.id, i, String(phoneRaw), name, String(emailRaw), phoneRes.e164, String(acquiredRaw || ''));

      // Try to find existing by rowKey first, then fallback to phoneE164/email/name within same source for robustness across formatting changes
      let existing = await prisma.customer.findUnique({ where:{ sheetRowKey: rowKey }});
      if (!existing && phoneRes.valid && phoneRes.e164) {
        existing = await prisma.customer.findFirst({ where:{ sourceId: source.id, phoneE164: phoneRes.e164 }});
        if (existing) {
          // migrate old rowKey to new stable key if found via phone (avoid future duplicates)
        }
      }
      if (!existing && email) {
        existing = await prisma.customer.findFirst({ where:{ sourceId: source.id, email: email }});
      }
      if (!existing) {
        // fallback by normalized name exact match within source (for cases where phone/email edited)
        // SQLite doesn't support mode:insensitive, so fetch and compare lowercased in JS
        const candidates = await prisma.customer.findMany({ where:{ sourceId: source.id }});
        const normName = name.toLowerCase().trim();
        existing = candidates.find(c => String(c.name).toLowerCase().trim() === normName) || null;
        // but only if only one match to avoid collisions; if multiple, stick to rowKey path which already failed
        // we already tried rowKey, so if we found via name but phone differs significantly, we still update that record
        if (existing) {
          const existingPhoneDigits = String(existing.phoneRaw).replace(/\D/g,'');
          const newPhoneDigits = String(phoneRaw).replace(/\D/g,'');
          // if phones differ completely and email differs, treat as new rather than update (to avoid merging distinct people same name)
          if (phoneRes.valid && existing.phoneValid && existing.phoneE164 !== phoneRes.e164 && existingPhoneDigits.length>=7 && newPhoneDigits.length>=7 && existingPhoneDigits !== newPhoneDigits) {
            // check email also
            if (!email || !existing.email || email.toLowerCase() !== String(existing.email).toLowerCase()) {
              existing = null;
            }
          }
        }
      }
      const dataToSave = {
        name,
        phoneRaw: String(phoneRaw),
        phoneE164: phoneRes.e164,
        phoneValid: phoneRes.valid,
        acquiredAt,
        acquiredAtRaw: String(acquiredRaw) || null,
        rating,
        comment,
        sentimentLabel: sentiment.label,
        sentimentScore: sentiment.score,
        sentimentHash: sentiment.hash,
        optInWhatsApp: optIn,
        email,
        keyAttributes,
        sourceId: source.id,
      };

      if (existing) {
        // Check if changed (including sheetRowKey migration)
        const changed = (
          existing.name !== dataToSave.name ||
          existing.phoneRaw !== dataToSave.phoneRaw ||
          existing.phoneE164 !== dataToSave.phoneE164 ||
          existing.rating !== dataToSave.rating ||
          existing.comment !== dataToSave.comment ||
          existing.optInWhatsApp !== dataToSave.optInWhatsApp ||
          existing.email !== dataToSave.email ||
          (existing.acquiredAt?.getTime() ?? null) !== (dataToSave.acquiredAt?.getTime() ?? null) ||
          existing.sheetRowKey !== rowKey
        );
        if (changed || existing.sentimentHash !== sentiment.hash) {
          const updateData: any = { ...dataToSave };
          if (existing.sheetRowKey !== rowKey) {
            // migrate to more stable key safely (already checked uniqueness)
            updateData.sheetRowKey = rowKey;
          }
          await prisma.customer.update({ where:{ id: existing.id }, data: updateData });
          updated++;
        } else {
          // no change, skip count?
        }
      } else {
        await prisma.customer.create({ data: { ...dataToSave, sheetRowKey: rowKey }});
        added++;
      }
    } catch (e:any) {
      skipped++; skippedReasons.push({row:rowNum, reason: e.message || 'Unknown error'});
    }
  }

  await prisma.sheetSource.update({ where:{ id: source.id }, data:{ lastSyncedAt: new Date() }});

  return { added, updated, skipped, skippedReasons: skippedReasons.slice(0,20), detectedMapping: mapping, confidence: confidence as any, needsConfirmation:false, sourceId: source.id, title: data.title };
}

function safeParse(s: string): any {
  try { return typeof s==='string' ? JSON.parse(s) : s; } catch { return null; }
}

export async function getSourceWithMapping(sourceId: string) {
  return prisma.sheetSource.findUnique({ where:{ id: sourceId }});
}
