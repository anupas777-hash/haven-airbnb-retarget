import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config/index.js';

function parseDbPath(url: string): string {
  if (!url) return path.join(process.cwd(), 'prisma', 'dev.db');
  if (url.startsWith('file:')) {
    const p = url.slice(5);
    return p.startsWith('/') ? p : path.resolve(process.cwd(), p);
  }
  return url;
}

const dbPath = parseDbPath(process.env.DATABASE_URL || (config as any).databaseUrl || 'file:./prisma/dev.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new DatabaseSync(dbPath);

// Ensure tables exist - handles both old and new schema
function ensureTables() {
  try {
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[];
    const tableNames = new Set(tables.map((t: any) => t.name));

    // Legacy migration path
    if (!tableNames.has('Customer')) {
      console.log('[prisma] Creating legacy tables from migration...');
      const migrationPath = path.join(path.dirname(dbPath), 'migrations', '20260825130101_init', 'migration.sql');
      let sql = '';
      if (fs.existsSync(migrationPath)) {
        sql = fs.readFileSync(migrationPath, 'utf8');
      } else {
        sql = `
        CREATE TABLE IF NOT EXISTS "SheetSource" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "url" TEXT NOT NULL,
            "sheetId" TEXT,
            "title" TEXT NOT NULL DEFAULT 'Customer Sheet',
            "confirmedMapping" TEXT,
            "detectedMapping" TEXT,
            "lastSyncedAt" DATETIME,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "Customer" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "name" TEXT NOT NULL,
            "phoneRaw" TEXT NOT NULL,
            "phoneE164" TEXT,
            "phoneValid" BOOLEAN NOT NULL DEFAULT false,
            "acquiredAt" DATETIME,
            "acquiredAtRaw" TEXT,
            "rating" INTEGER,
            "comment" TEXT,
            "sentimentLabel" TEXT NOT NULL DEFAULT 'neutral',
            "sentimentScore" REAL NOT NULL DEFAULT 0,
            "sentimentHash" TEXT,
            "optInWhatsApp" BOOLEAN NOT NULL DEFAULT false,
            "email" TEXT,
            "keyAttributes" TEXT,
            "sheetRowKey" TEXT NOT NULL,
            "sourceId" TEXT,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "MessageTemplate" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "name" TEXT NOT NULL,
            "channel" TEXT NOT NULL DEFAULT 'whatsapp',
            "whatsappTemplateName" TEXT,
            "locale" TEXT NOT NULL DEFAULT 'en_US',
            "body" TEXT NOT NULL,
            "variables" TEXT NOT NULL,
            "status" TEXT NOT NULL DEFAULT 'draft',
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "Campaign" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "name" TEXT NOT NULL,
            "cohortRule" TEXT NOT NULL,
            "discountPercent" INTEGER NOT NULL DEFAULT 10,
            "templateId" TEXT,
            "status" TEXT NOT NULL DEFAULT 'draft',
            "filtersSnapshot" TEXT,
            "selectionMode" TEXT NOT NULL DEFAULT 'none',
            "selectedIds" TEXT,
            "deselectedIds" TEXT,
            "selectionFilters" TEXT,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "Delivery" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "campaignId" TEXT NOT NULL,
            "customerId" TEXT NOT NULL,
            "status" TEXT NOT NULL DEFAULT 'queued',
            "providerMessageId" TEXT,
            "error" TEXT,
            "attempt" INTEGER NOT NULL DEFAULT 0,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL
        );
        `;
      }
      const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        try { db.exec(stmt); } catch {}
      }
    }

    // Ensure keyAttributes column
    try {
      const cols = db.prepare(`PRAGMA table_info(Customer)`).all() as any[];
      const hasKey = cols.some((c: any) => c.name === 'keyAttributes');
      if (!hasKey) db.exec(`ALTER TABLE Customer ADD COLUMN keyAttributes TEXT`);
      const hasGender = cols.some((c: any) => c.name === 'gender');
      if (!hasGender) db.exec(`ALTER TABLE Customer ADD COLUMN gender TEXT`);
      const hasRoom = cols.some((c: any) => c.name === 'room');
      if (!hasRoom) db.exec(`ALTER TABLE Customer ADD COLUMN room TEXT`);
      const hasPropId = cols.some((c: any) => c.name === 'propertyId');
      if (!hasPropId) db.exec(`ALTER TABLE Customer ADD COLUMN propertyId TEXT`);
    } catch {}

    // Ensure SheetSource extra columns
    try {
      const cols = db.prepare(`PRAGMA table_info(SheetSource)`).all() as any[];
      if (!cols.some((c: any) => c.name === 'propertyId')) db.exec(`ALTER TABLE SheetSource ADD COLUMN propertyId TEXT`);
      if (!cols.some((c: any) => c.name === 'type')) db.exec(`ALTER TABLE SheetSource ADD COLUMN type TEXT DEFAULT 'customers'`);
    } catch {}

    // ── New multi-property tables ──
    if (!tableNames.has('Property')) {
      console.log('[prisma] Creating Property table...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS "Property" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "slug" TEXT NOT NULL,
          "city" TEXT NOT NULL,
          "country" TEXT NOT NULL DEFAULT 'India',
          "address" TEXT,
          "airbnbListingId" TEXT,
          "airbnbUrl" TEXT,
          "type" TEXT,
          "bedrooms" INTEGER,
          "beds" INTEGER,
          "status" TEXT NOT NULL DEFAULT 'active',
          "sheetUrl" TEXT,
          "sheetId" TEXT,
          "revenueSheetName" TEXT,
          "expenseSheetName" TEXT,
          "color" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL
        );
      `);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "Property_slug_key" ON "Property"("slug");`);
      db.exec(`CREATE INDEX IF NOT EXISTS "Property_city_idx" ON "Property"("city");`);
    }

    if (!tableNames.has('Revenue')) {
      console.log('[prisma] Creating Revenue table...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS "Revenue" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "propertyId" TEXT NOT NULL,
          "date" DATETIME NOT NULL,
          "dateRaw" TEXT,
          "bookingId" TEXT,
          "guestName" TEXT,
          "checkIn" DATETIME,
          "checkOut" DATETIME,
          "nights" INTEGER,
          "room" TEXT,
          "baseAmount" REAL,
          "cleaningFee" REAL,
          "extraGuestFee" REAL,
          "taxes" REAL,
          "discount" REAL,
          "platformFee" REAL,
          "payout" REAL,
          "payment" REAL,
          "netRevenue" REAL,
          "gender" TEXT,
          "duration" TEXT,
          "paymentRaw" TEXT,
          "channel" TEXT DEFAULT 'airbnb',
          "status" TEXT DEFAULT 'confirmed',
          "notes" TEXT,
          "sheetRowKey" TEXT NOT NULL,
          "source" TEXT,
          "sourceUrl" TEXT,
          "rawData" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL,
          CONSTRAINT "Revenue_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        );
      `);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "Revenue_sheetRowKey_key" ON "Revenue"("sheetRowKey");`);
      db.exec(`CREATE INDEX IF NOT EXISTS "Revenue_propertyId_idx" ON "Revenue"("propertyId");`);
      db.exec(`CREATE INDEX IF NOT EXISTS "Revenue_date_idx" ON "Revenue"("date");`);
    }

    if (!tableNames.has('Expense')) {
      console.log('[prisma] Creating Expense table...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS "Expense" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "propertyId" TEXT NOT NULL,
          "date" DATETIME NOT NULL,
          "dateRaw" TEXT,
          "category" TEXT NOT NULL,
          "subcategory" TEXT,
          "vendor" TEXT,
          "amount" REAL NOT NULL,
          "currency" TEXT NOT NULL DEFAULT 'INR',
          "paymentMethod" TEXT,
          "recurring" BOOLEAN NOT NULL DEFAULT false,
          "recurringInterval" TEXT,
          "receiptUrl" TEXT,
          "notes" TEXT,
          "sheetRowKey" TEXT NOT NULL,
          "source" TEXT,
          "sourceUrl" TEXT,
          "rawData" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL,
          CONSTRAINT "Expense_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        );
      `);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "Expense_sheetRowKey_key" ON "Expense"("sheetRowKey");`);
      db.exec(`CREATE INDEX IF NOT EXISTS "Expense_propertyId_idx" ON "Expense"("propertyId");`);
      db.exec(`CREATE INDEX IF NOT EXISTS "Expense_date_idx" ON "Expense"("date");`);
      db.exec(`CREATE INDEX IF NOT EXISTS "Expense_category_idx" ON "Expense"("category");`);
    }

    if (!tableNames.has('Booking')) {
      console.log('[prisma] Creating Booking table...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS "Booking" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "propertyId" TEXT NOT NULL,
          "bookingId" TEXT,
          "guestName" TEXT NOT NULL,
          "guestPhone" TEXT,
          "guestEmail" TEXT,
          "checkIn" DATETIME NOT NULL,
          "checkOut" DATETIME NOT NULL,
          "nights" INTEGER NOT NULL,
          "guests" INTEGER,
          "status" TEXT NOT NULL DEFAULT 'confirmed',
          "totalAmount" REAL,
          "source" TEXT DEFAULT 'airbnb',
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL,
          CONSTRAINT "Booking_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS "Booking_propertyId_idx" ON "Booking"("propertyId");`);
    }

  } catch (e) {
    console.error('[prisma] ensureTables error', e);
  }
}

ensureTables();

function genId() {
  return 'c' + crypto.randomBytes(12).toString('hex');
}

function toDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

function convertRow(table: string, row: any): any {
  if (!row) return row;
  const r = { ...row };
  const dateFields: Record<string, string[]> = {
    Customer: ['acquiredAt', 'createdAt', 'updatedAt'],
    SheetSource: ['lastSyncedAt', 'createdAt', 'updatedAt'],
    Campaign: ['createdAt', 'updatedAt'],
    MessageTemplate: ['createdAt', 'updatedAt'],
    Delivery: ['createdAt', 'updatedAt'],
    Property: ['createdAt', 'updatedAt'],
    Revenue: ['date', 'checkIn', 'checkOut', 'createdAt', 'updatedAt'],
    Expense: ['date', 'createdAt', 'updatedAt'],
    Booking: ['checkIn', 'checkOut', 'createdAt', 'updatedAt'],
  };
  const boolFields: Record<string, string[]> = {
    Customer: ['phoneValid', 'optInWhatsApp'],
    Expense: ['recurring'],
  };
  if (dateFields[table]) {
    for (const f of dateFields[table]) {
      if (f in r && r[f]) r[f] = toDate(r[f]);
    }
  }
  if (boolFields[table]) {
    for (const f of boolFields[table]) {
      if (f in r) r[f] = !!r[f];
    }
  }
  return r;
}

function matchesOperator(rowVal: any, opObj: any): boolean {
  for (const op of Object.keys(opObj)) {
    const val = opObj[op];
    if (op === 'in') {
      if (!Array.isArray(val)) return false;
      if (rowVal instanceof Date) {
        const rowTime = rowVal.getTime();
        const found = val.some((v: any) => {
          const dv = v instanceof Date ? v.getTime() : new Date(v).getTime();
          return dv === rowTime;
        });
        if (!found) return false;
      } else {
        if (!val.includes(rowVal)) return false;
      }
    } else if (op === 'notIn') {
      if (Array.isArray(val) && val.includes(rowVal)) return false;
    } else if (op === 'gte') {
      const rv = rowVal instanceof Date ? rowVal.getTime() : rowVal;
      const vv = val instanceof Date ? val.getTime() : (typeof val === 'string' && !isNaN(Date.parse(val)) ? new Date(val).getTime() : val);
      if (rv == null || rv < vv) return false;
    } else if (op === 'lte') {
      const rv = rowVal instanceof Date ? rowVal.getTime() : rowVal;
      const vv = val instanceof Date ? val.getTime() : (typeof val === 'string' && !isNaN(Date.parse(val)) ? new Date(val).getTime() : val);
      if (rv == null || rv > vv) return false;
    } else if (op === 'gt') {
      const rv = rowVal instanceof Date ? rowVal.getTime() : rowVal;
      const vv = val instanceof Date ? val.getTime() : (typeof val === 'string' && !isNaN(Date.parse(val)) ? new Date(val).getTime() : val);
      if (rv == null || rv <= vv) return false;
    } else if (op === 'lt') {
      const rv = rowVal instanceof Date ? rowVal.getTime() : rowVal;
      const vv = val instanceof Date ? val.getTime() : (typeof val === 'string' && !isNaN(Date.parse(val)) ? new Date(val).getTime() : val);
      if (rv == null || rv >= vv) return false;
    } else if (op === 'contains') {
      if (typeof rowVal !== 'string' || !rowVal.includes(val)) return false;
    } else if (op === 'startsWith') {
      if (typeof rowVal !== 'string' || !rowVal.startsWith(val)) return false;
    } else if (op === 'endsWith') {
      if (typeof rowVal !== 'string' || !rowVal.endsWith(val)) return false;
    }
  }
  return true;
}

function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const key of Object.keys(where)) {
    if (key === 'campaignId_customerId') {
      const comp = where[key];
      if (row.campaignId !== comp.campaignId || row.customerId !== comp.customerId) return false;
      continue;
    }
    const cond = where[key];
    const rowVal = row[key];
    if (cond == null) {
      if (rowVal != null) return false;
      continue;
    }
    if (typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      const ops = Object.keys(cond);
      const isOperator = ops.some(op => ['in', 'notIn', 'gte', 'lte', 'gt', 'lt', 'contains', 'startsWith', 'endsWith'].includes(op));
      if (isOperator) {
        if (!matchesOperator(rowVal, cond)) return false;
      } else {
        if (!matchesWhere(rowVal || {}, cond)) return false;
      }
    } else {
      if (rowVal instanceof Date && cond instanceof Date) {
        if (rowVal.getTime() !== cond.getTime()) return false;
      } else if (rowVal instanceof Date && typeof cond === 'string') {
        const cd = new Date(cond);
        if (rowVal.getTime() !== cd.getTime()) return false;
      } else {
        if (rowVal !== cond) return false;
      }
    }
  }
  return true;
}

function applyOrderBy(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const ob of orders) {
      const field = Object.keys(ob)[0];
      const dir = ob[field];
      const av = a[field];
      const bv = b[field];
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp = 0;
      if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime();
      else if (typeof av === 'string' && typeof bv === 'string') cmp = av.localeCompare(bv);
      else if (av < bv) cmp = -1;
      else if (av > bv) cmp = 1;
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function filterSelect(row: any, select: any): any {
  if (!select) return row;
  const out: any = {};
  for (const k of Object.keys(select)) {
    if (select[k]) out[k] = row[k];
  }
  return out;
}

class Table<T> {
  constructor(private name: string) {}

  private allRows(): any[] {
    try {
      const rows = db.prepare(`SELECT * FROM "${this.name}"`).all() as any[];
      return rows.map(r => convertRow(this.name, r));
    } catch (e) {
      return [];
    }
  }

  async findMany(args: any = {}): Promise<any[]> {
    let rows = this.allRows();
    if (args.where) rows = rows.filter(r => matchesWhere(r, args.where));
    if (args.orderBy) rows = applyOrderBy(rows, args.orderBy);
    if (args.select) rows = rows.map(r => filterSelect(r, args.select));
    if (args.include) rows = await this.applyInclude(rows, args.include);
    return rows;
  }

  async findUnique(args: any): Promise<any | null> {
    const rows = this.allRows();
    const found = rows.find(r => matchesWhere(r, args.where)) || null;
    if (!found) return null;
    let result = found;
    if (args.select) result = filterSelect(result, args.select);
    if (args.include) {
      const arr = await this.applyInclude([result], args.include);
      result = arr[0];
    }
    return result;
  }

  async findFirst(args: any = {}): Promise<any | null> {
    let rows = this.allRows();
    if (args.where) rows = rows.filter(r => matchesWhere(r, args.where));
    if (args.orderBy) rows = applyOrderBy(rows, args.orderBy);
    const first = rows[0] || null;
    if (!first) return null;
    let result = first;
    if (args.select) result = filterSelect(result, args.select);
    if (args.include) {
      const arr = await this.applyInclude([result], args.include);
      result = arr[0];
    }
    return result;
  }

  async create(args: any): Promise<any> {
    const data = args.data;
    const id = data.id || genId();
    const now = new Date().toISOString();
    const row: any = { id, createdAt: now, updatedAt: now };
    // Filter out undefined - SQLite can't bind undefined
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) row[k] = v;
    }
    if (this.name === 'Customer') {
      if ('phoneValid' in row) row.phoneValid = row.phoneValid ? 1 : 0;
      if ('optInWhatsApp' in row) row.optInWhatsApp = row.optInWhatsApp ? 1 : 0;
      if (row.acquiredAt instanceof Date) row.acquiredAt = row.acquiredAt.toISOString();
    }
    if (this.name === 'Expense' && 'recurring' in row) row.recurring = row.recurring ? 1 : 0;
    for (const k of ['createdAt', 'updatedAt', 'lastSyncedAt', 'date', 'checkIn', 'checkOut']) {
      if (row[k] instanceof Date) row[k] = row[k].toISOString();
    }
    // Ensure no undefined remains
    for (const k of Object.keys(row)) {
      if (row[k] === undefined) row[k] = null;
    }
    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(', ');
    const colNames = cols.map(c => `"${c}"`).join(', ');
    try {
      db.prepare(`INSERT INTO "${this.name}" (${colNames}) VALUES (${placeholders})`).run(...cols.map(c => row[c]));
    } catch (e: any) {
      console.error(`[${this.name}] create error`, e.message, row);
      throw e;
    }
    const inserted = db.prepare(`SELECT * FROM "${this.name}" WHERE id = ?`).get(id) as any;
    return convertRow(this.name, inserted);
  }

  async createMany(args: any): Promise<any> {
    const datas = args.data;
    let count = 0;
    for (const data of datas) {
      await this.create({ data });
      count++;
    }
    return { count };
  }

  async update(args: any): Promise<any> {
    const where = args.where;
    const data = args.data;
    const existingRows = this.allRows().filter(r => matchesWhere(r, where));
    if (existingRows.length === 0) throw new Error(`${this.name} not found for update`);
    const existing = existingRows[0];
    const id = existing.id;
    const now = new Date().toISOString();
    const updated: any = { ...existing, ...data, updatedAt: now };
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (v && typeof v === 'object' && 'increment' in v) updated[k] = (existing[k] || 0) + v.increment;
    }
    const storage: any = { ...updated };
    // Remove undefined
    for (const k of Object.keys(storage)) {
      if (storage[k] === undefined) delete storage[k];
    }
    if (this.name === 'Customer') {
      if ('phoneValid' in storage) storage.phoneValid = storage.phoneValid ? 1 : 0;
      if ('optInWhatsApp' in storage) storage.optInWhatsApp = storage.optInWhatsApp ? 1 : 0;
      if (storage.acquiredAt instanceof Date) storage.acquiredAt = storage.acquiredAt.toISOString();
    }
    if (this.name === 'Expense' && 'recurring' in storage) storage.recurring = storage.recurring ? 1 : 0;
    for (const k of ['createdAt', 'updatedAt', 'lastSyncedAt', 'date', 'checkIn', 'checkOut']) {
      if (storage[k] instanceof Date) storage[k] = storage[k].toISOString();
    }
    for (const k of Object.keys(storage)) {
      if (storage[k] === undefined) storage[k] = null;
    }
    const cols = Object.keys(storage).filter(c => c !== 'id');
    const setClause = cols.map(c => `"${c}" = ?`).join(', ');
    try {
      db.prepare(`UPDATE "${this.name}" SET ${setClause} WHERE id = ?`).run(...cols.map(c => storage[c]), id);
    } catch (e: any) {
      console.error(`[${this.name}] update error`, e.message);
      throw e;
    }
    const after = db.prepare(`SELECT * FROM "${this.name}" WHERE id = ?`).get(id) as any;
    return convertRow(this.name, after);
  }

  async updateMany(args: any): Promise<any> {
    const where = args.where || {};
    const data = args.data;
    let rows = this.allRows().filter(r => matchesWhere(r, where));
    let count = 0;
    for (const r of rows) {
      await this.update({ where: { id: r.id }, data });
      count++;
    }
    return { count };
  }

  async delete(args: any): Promise<any> {
    const where = args.where;
    const rows = this.allRows().filter(r => matchesWhere(r, where));
    if (rows.length === 0) throw new Error(`${this.name} not found for delete`);
    const id = rows[0].id;
    db.prepare(`DELETE FROM "${this.name}" WHERE id = ?`).run(id);
    return rows[0];
  }

  async count(args: any = {}): Promise<number> {
    let rows = this.allRows();
    if (args.where) rows = rows.filter(r => matchesWhere(r, args.where));
    return rows.length;
  }

  private async applyInclude(rows: any[], include: any): Promise<any[]> {
    const result = [...rows];
    if (this.name === 'Campaign' && include.template) {
      const templateTable = new Table('MessageTemplate');
      for (const r of result) {
        if (r.templateId) {
          const t = await templateTable.findUnique({ where: { id: r.templateId } });
          (r as any).template = t;
        } else (r as any).template = null;
      }
    }
    if (this.name === 'Campaign' && include.deliveries) {
      const deliveryTable = new Table('Delivery');
      for (const r of result) {
        const dels = await deliveryTable.findMany({ where: { campaignId: r.id } });
        (r as any).deliveries = dels;
      }
    }
    if (this.name === 'Delivery' && include.customer) {
      const custTable = new Table('Customer');
      for (const r of result) {
        const c = await custTable.findUnique({ where: { id: r.customerId } });
        (r as any).customer = c;
      }
    }
    if (this.name === 'Revenue' && include.property) {
      const propTable = new Table('Property');
      for (const r of result) {
        const p = await propTable.findUnique({ where: { id: r.propertyId } });
        (r as any).property = p;
      }
    }
    if (this.name === 'Expense' && include.property) {
      const propTable = new Table('Property');
      for (const r of result) {
        const p = await propTable.findUnique({ where: { id: r.propertyId } });
        (r as any).property = p;
      }
    }
    if (this.name === 'Property') {
      if (include.revenues) {
        const revTable = new Table('Revenue');
        for (const r of result) (r as any).revenues = await revTable.findMany({ where: { propertyId: r.id } });
      }
      if (include.expenses) {
        const expTable = new Table('Expense');
        for (const r of result) (r as any).expenses = await expTable.findMany({ where: { propertyId: r.id } });
      }
    }
    return result;
  }
}

export const prisma = {
  customer: new Table('Customer'),
  sheetSource: new Table('SheetSource'),
  campaign: new Table('Campaign'),
  messageTemplate: new Table('MessageTemplate'),
  delivery: new Table('Delivery'),
  property: new Table('Property'),
  revenue: new Table('Revenue'),
  expense: new Table('Expense'),
  booking: new Table('Booking'),
  $connect: async () => {},
  $disconnect: async () => { try { db.close(); } catch {} },
};

export async function ensurePrismaConnected() {
  try { await prisma.$connect(); } catch {}
}
