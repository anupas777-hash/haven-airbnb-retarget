import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { prisma } from '../repositories/prisma.js';
import { normalizePhone } from '../domain/E164Phone.js';
import { parseDateLenient, coerceOptIn } from '../domain/CohortRule.js';
import { sentimentService } from './sentimentService.js';
import { detectColumnMapping } from '../domain/ColumnMapping.js';

type IngestResult = {
  added: number;
  updated: number;
  skipped: number;
  title: string;
  propertyId?: string;
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function parseAmount(val: any): number | null {
  if (val == null || val === '') return null;
  const s = String(val).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export async function ingestXlsxFile(filePath: string, propertyId?: string): Promise<IngestResult> {
  const workbook = XLSX.readFile(filePath);
  const sheetNames = workbook.SheetNames;
  console.log(`[xlsx] File ${filePath} sheets: ${sheetNames.join(', ')}`);

  let totalAdded = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let title = path.basename(filePath);

  // Try to detect if this is a revenue, expense, or customer sheet based on file name and sheet content
  const fileNameLower = filePath.toLowerCase();
  const isRevenue = fileNameLower.includes('revenue') || fileNameLower.includes('booking') || fileNameLower.includes('income');
  const isExpense = fileNameLower.includes('expense') || fileNameLower.includes('cost');

  for (const sheetName of sheetNames) {
    const ws = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
    if (json.length < 2) continue;

    const headers = json[0].map((h: any) => String(h || '').trim()).filter(Boolean);
    if (headers.length < 2) continue;

    const rows: Record<string, string>[] = json.slice(1).map(r => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => obj[h] = String(r[i] ?? '').trim());
      return obj;
    }).filter(row => Object.values(row).some(v => v !== ''));

    if (rows.length === 0) continue;

    console.log(`[xlsx] Sheet ${sheetName}: ${headers.length} cols, ${rows.length} rows, headers: ${headers.slice(0,10).join(', ')}`);

    // Detect type by headers
    const headerStr = headers.join(' ').toLowerCase();
    const isRevSheet = isRevenue || headerStr.includes('revenue') || headerStr.includes('booking') || headerStr.includes('payout') || headerStr.includes('payment given') || sheetName.toLowerCase().includes('revenue');
    const isExpSheet = isExpense || headerStr.includes('expense') || headerStr.includes('cost') || headerStr.includes('category') || sheetName.toLowerCase().includes('expense');

    if (isRevSheet && !isExpSheet) {
      const result = await ingestRevenueRows(rows, headers, filePath, propertyId);
      totalAdded += result.added;
      totalUpdated += result.updated;
      totalSkipped += result.skipped;
    } else if (isExpSheet && !isRevSheet) {
      const result = await ingestExpenseRows(rows, headers, filePath, propertyId);
      totalAdded += result.added;
      totalUpdated += result.updated;
      totalSkipped += result.skipped;
    } else {
      // Try to auto-detect: if has Customer Name/Phone, it's customer/guest sheet
      // If has amount/category, expense, if has payment/booking, revenue
      const { mapping } = detectColumnMapping(headers);
      if (mapping.name && mapping.phone) {
        // Guest sheet - treat as customer
        const result = await ingestCustomerRows(rows, headers, filePath, propertyId);
        totalAdded += result.added;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
      } else if (headerStr.includes('amount') && headerStr.includes('category')) {
        const result = await ingestExpenseRows(rows, headers, filePath, propertyId);
        totalAdded += result.added;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
      } else {
        // Default to revenue
        const result = await ingestRevenueRows(rows, headers, filePath, propertyId);
        totalAdded += result.added;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
      }
    }
  }

  return { added: totalAdded, updated: totalUpdated, skipped: totalSkipped, title, propertyId };
}

async function getOrCreateProperty(propertyId?: string, filePath?: string): Promise<any> {
  if (propertyId) {
    const prop = await prisma.property.findUnique({ where: { id: propertyId } });
    if (prop) return prop;
  }
  // Try to infer property from file path
  const base = filePath ? path.basename(filePath).toLowerCase() : '';
  // Look for existing property that matches file name
  const properties = await prisma.property.findMany();
  for (const p of properties) {
    if (base.includes(slugify(p.name)) || base.includes(p.slug) || base.includes(p.city.toLowerCase())) {
      return p;
    }
  }
  // If no property found, create a default one based on file name
  if (properties.length === 0) {
    // Create default property
    const name = filePath ? path.basename(filePath, path.extname(filePath)).replace(/[-_]/g, ' ') : 'Default Property';
    const slug = slugify(name) || `prop-${Date.now()}`;
    const existing = await prisma.property.findUnique({ where: { slug } }).catch(() => null);
    if (existing) return existing;
    return await prisma.property.create({
      data: {
        name: name || 'Default Property',
        slug,
        city: 'Goa',
        country: 'India',
        status: 'active',
      }
    });
  }
  return properties[0];
}

async function ingestRevenueRows(rows: Record<string, string>[], headers: string[], filePath: string, propertyId?: string) {
  let added = 0, updated = 0, skipped = 0;
  const property = await getOrCreateProperty(propertyId, filePath);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      // Try to map common fields from user's actual sheet structure
      const guestName = row['Customer Name'] || row['Guest'] || row['Guest Name'] || row['customer name'] || row['Name'] || '';
      const phoneRaw = row['Phone Number'] || row['Phone'] || row['Mobile'] || '';
      const gender = row['Gender'] || '';
      const room = row['Room'] || row['Room Number'] || '';
      const ratingRaw = row['Rating Given'] || row['Rating'] || row['Stars'] || '';
      const dateRaw = row['Date of 1st Booking'] || row['Acquired Date'] || row['Date'] || row['Booking Date'] || row['Check-in'] || '';
      const duration = row['Duration of 1st Booking'] || row['Duration'] || row['Nights'] || '';
      const paymentRaw = row['Payment Given on 1st Booking'] || row['Payment'] || row['Amount'] || row['Base Amount'] || row['Payout'] || row['Revenue'] || '';
      const keyAttributes = row['Key Attributes of Customer'] || row['Key Attributes'] || row['Attributes'] || '';
      const comment = row['Rating Comment'] || row['Comment'] || row['Review'] || '';

      const name = String(guestName).trim() || `Guest ${i+1}`;
      const date = parseDateLenient(String(dateRaw)) || new Date();
      const payment = parseAmount(paymentRaw);
      const rating = ratingRaw ? parseInt(String(ratingRaw), 10) : null;

      const sheetRowKey = `${property.id}:rev:${String(phoneRaw).replace(/\D/g,'')}:${String(dateRaw)}:${i}`;

      let existing = await prisma.revenue.findUnique({ where: { sheetRowKey } }).catch(() => null);
      if (!existing) {
        // Try find by property + date + guest
        const candidates = await prisma.revenue.findMany({ where: { propertyId: property.id } });
        existing = candidates.find(r => {
          const sameDate = r.dateRaw === String(dateRaw);
          const sameGuest = String(r.guestName).toLowerCase() === String(guestName).toLowerCase();
          return sameDate && sameGuest;
        }) || null;
      }

      const dataToSave = {
        propertyId: property.id,
        date,
        dateRaw: String(dateRaw) || null,
        guestName: name,
        room: String(room) || null,
        gender: String(gender) || null,
        duration: String(duration) || null,
        paymentRaw: String(paymentRaw) || null,
        baseAmount: payment,
        payment: payment,
        payout: payment,
        netRevenue: payment,
        rating: rating,
        notes: String(keyAttributes || comment || '').slice(0, 500) || null,
        sheetRowKey,
        source: 'xlsx-upload',
        sourceUrl: filePath,
        rawData: JSON.stringify(row).slice(0, 2000),
      };

      if (existing) {
        await prisma.revenue.update({ where: { id: existing.id }, data: dataToSave });
        updated++;
      } else {
        await prisma.revenue.create({ data: dataToSave as any });
        added++;
      }

      // Also create customer if phone exists
      if (phoneRaw) {
        const phoneRes = normalizePhone(String(phoneRaw));
        const custRowKey = `${property.id}:cust:${phoneRes.e164 || String(phoneRaw).replace(/\D/g,'')}:${i}`;
        let custExisting = await prisma.customer.findUnique({ where: { sheetRowKey: custRowKey } }).catch(() => null);
        const custData = {
          name,
          phoneRaw: String(phoneRaw),
          phoneE164: phoneRes.e164,
          phoneValid: phoneRes.valid,
          acquiredAt: date,
          acquiredAtRaw: String(dateRaw) || null,
          rating: rating && rating >=1 && rating <=5 ? rating : null,
          comment: String(comment).trim() || null,
          sentimentLabel: 'neutral',
          sentimentScore: 0,
          email: null,
          keyAttributes: String(keyAttributes).trim() || null,
          gender: String(gender) || null,
          room: String(room) || null,
          propertyId: property.id,
          sourceId: null,
        };
        if (custExisting) {
          await prisma.customer.update({ where: { id: custExisting.id }, data: custData });
        } else {
          try {
            await prisma.customer.create({ data: { ...custData, sheetRowKey: custRowKey } as any });
          } catch {}
        }
      }

    } catch (e: any) {
      skipped++;
      console.log(`[xlsx] Revenue row ${i} skipped: ${e.message}`);
    }
  }

  return { added, updated, skipped };
}

async function ingestExpenseRows(rows: Record<string, string>[], headers: string[], filePath: string, propertyId?: string) {
  let added = 0, updated = 0, skipped = 0;
  const property = await getOrCreateProperty(propertyId, filePath);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const dateRaw = row['Date'] || row['Expense Date'] || row['Date of Expense'] || '';
      const category = row['Category'] || row['Expense Category'] || row['Type'] || 'Other';
      const vendor = row['Vendor'] || row['Supplier'] || '';
      const amountRaw = row['Amount'] || row['Cost'] || row['Expense'] || '';
      const notes = row['Notes'] || row['Description'] || row['Remarks'] || '';
      const paymentMethod = row['Payment Method'] || row['Method'] || '';

      const date = parseDateLenient(String(dateRaw)) || new Date();
      const amount = parseAmount(amountRaw);
      if (!amount) { skipped++; continue; }

      const sheetRowKey = `${property.id}:exp:${String(dateRaw)}:${category}:${i}`;

      let existing = await prisma.expense.findUnique({ where: { sheetRowKey } }).catch(() => null);

      const dataToSave = {
        propertyId: property.id,
        date,
        dateRaw: String(dateRaw) || null,
        category: String(category) || 'Other',
        vendor: String(vendor) || null,
        amount,
        paymentMethod: String(paymentMethod) || null,
        notes: String(notes).slice(0, 500) || null,
        sheetRowKey,
        source: 'xlsx-upload',
        sourceUrl: filePath,
        rawData: JSON.stringify(row).slice(0, 2000),
      };

      if (existing) {
        await prisma.expense.update({ where: { id: existing.id }, data: dataToSave });
        updated++;
      } else {
        await prisma.expense.create({ data: dataToSave as any });
        added++;
      }
    } catch (e: any) {
      skipped++;
      console.log(`[xlsx] Expense row ${i} skipped: ${e.message}`);
    }
  }

  return { added, updated, skipped };
}

async function ingestCustomerRows(rows: Record<string, string>[], headers: string[], filePath: string, propertyId?: string) {
  let added = 0, updated = 0, skipped = 0;
  const property = await getOrCreateProperty(propertyId, filePath);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const nameRaw = row['Customer Name'] || row['Name'] || '';
      const phoneRaw = row['Phone Number'] || row['Phone'] || '';
      const dateRaw = row['Date of 1st Booking'] || row['Acquired Date'] || row['Date'] || '';
      const ratingRaw = row['Rating Given'] || row['Rating'] || '';
      const comment = row['Rating Comment'] || row['Comment'] || '';
      const keyAttributes = row['Key Attributes of Customer'] || '';

      const name = String(nameRaw).trim();
      if (!name) { skipped++; continue; }

      const phoneRes = normalizePhone(String(phoneRaw));
      const date = parseDateLenient(String(dateRaw));

      const sheetRowKey = `${property.id}:cust:${phoneRes.e164 || String(phoneRaw).replace(/\D/g,'')}:${String(dateRaw)}:${i}`;

      let existing = await prisma.customer.findUnique({ where: { sheetRowKey } }).catch(() => null);

      const dataToSave = {
        name,
        phoneRaw: String(phoneRaw),
        phoneE164: phoneRes.e164,
        phoneValid: phoneRes.valid,
        acquiredAt: date,
        acquiredAtRaw: String(dateRaw) || null,
        rating: ratingRaw ? parseInt(String(ratingRaw), 10) : null,
        comment: String(comment).trim() || null,
        keyAttributes: String(keyAttributes).trim() || null,
        propertyId: property.id,
      };

      if (existing) {
        await prisma.customer.update({ where: { id: existing.id }, data: dataToSave as any });
        updated++;
      } else {
        try {
          await prisma.customer.create({ data: { ...dataToSave, sheetRowKey } as any });
          added++;
        } catch {
          skipped++;
        }
      }
    } catch (e: any) {
      skipped++;
    }
  }

  return { added, updated, skipped };
}

export async function ingestAllXlsxFromDataFolder(dataDir = path.join(process.cwd(), '../../data/sheets')): Promise<{ files: number; totalAdded: number }> {
  const absDir = path.isAbsolute(dataDir) ? dataDir : path.join(process.cwd(), dataDir);
  console.log(`[xlsx] Scanning ${absDir}`);
  if (!fs.existsSync(absDir)) {
    console.log(`[xlsx] Data dir not found: ${absDir}`);
    return { files: 0, totalAdded: 0 };
  }
  const files = fs.readdirSync(absDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.csv'));
  let totalAdded = 0;
  for (const file of files) {
    const fullPath = path.join(absDir, file);
    try {
      const result = await ingestXlsxFile(fullPath);
      totalAdded += result.added;
      console.log(`[xlsx] ${file}: added ${result.added}, updated ${result.updated}`);
    } catch (e: any) {
      console.error(`[xlsx] Failed ${file}: ${e.message}`);
    }
  }
  return { files: files.length, totalAdded };
}
