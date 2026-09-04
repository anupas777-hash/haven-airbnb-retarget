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

// Ensure tables exist
function ensureTables() {
  try {
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[];
    const tableNames = tables.map((t: any) => t.name);
    if (!tableNames.includes('Customer')) {
      console.log('[prisma-mock] Creating tables from migration...');
      const migrationPath = path.join(path.dirname(dbPath), 'migrations', '20260825130101_init', 'migration.sql');
      const migration2Path = path.join(path.dirname(dbPath), 'migrations', '20260827112605_add_key_attributes', 'migration.sql');
      let sql = '';
      if (fs.existsSync(migrationPath)) {
        sql = fs.readFileSync(migrationPath, 'utf8');
      } else {
        // fallback inline
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
      // Execute statements
      const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        try {
          db.exec(stmt);
        } catch (e) {
          // ignore if exists
        }
      }
      // Try second migration for keyAttributes
      if (fs.existsSync(migration2Path)) {
        try {
          const sql2 = fs.readFileSync(migration2Path, 'utf8');
          const stmts2 = sql2.split(';').map(s => s.trim()).filter(Boolean);
          for (const stmt of stmts2) {
            try { db.exec(stmt); } catch {}
          }
        } catch {}
      } else {
        // ensure keyAttributes column
        try {
          const cols = db.prepare(`PRAGMA table_info(Customer)`).all() as any[];
          const hasKey = cols.some((c: any) => c.name === 'keyAttributes');
          if (!hasKey) {
            db.exec(`ALTER TABLE Customer ADD COLUMN keyAttributes TEXT`);
          }
        } catch {}
      }
    } else {
      // ensure keyAttributes exists even if tables exist
      try {
        const cols = db.prepare(`PRAGMA table_info(Customer)`).all() as any[];
        const hasKey = cols.some((c: any) => c.name === 'keyAttributes');
        if (!hasKey) {
          db.exec(`ALTER TABLE Customer ADD COLUMN keyAttributes TEXT`);
        }
      } catch {}
    }
  } catch (e) {
    console.error('[prisma-mock] ensureTables error', e);
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
  // booleans
  if (table === 'Customer') {
    if ('phoneValid' in r) r.phoneValid = !!r.phoneValid;
    if ('optInWhatsApp' in r) r.optInWhatsApp = !!r.optInWhatsApp;
    if ('acquiredAt' in r) r.acquiredAt = r.acquiredAt ? toDate(r.acquiredAt) : null;
    if ('createdAt' in r) r.createdAt = toDate(r.createdAt);
    if ('updatedAt' in r) r.updatedAt = toDate(r.updatedAt);
  } else if (table === 'SheetSource') {
    if ('lastSyncedAt' in r) r.lastSyncedAt = r.lastSyncedAt ? toDate(r.lastSyncedAt) : null;
    if ('createdAt' in r) r.createdAt = toDate(r.createdAt);
    if ('updatedAt' in r) r.updatedAt = toDate(r.updatedAt);
  } else if (table === 'Campaign') {
    if ('createdAt' in r) r.createdAt = toDate(r.createdAt);
    if ('updatedAt' in r) r.updatedAt = toDate(r.updatedAt);
  } else if (table === 'MessageTemplate') {
    if ('createdAt' in r) r.createdAt = toDate(r.createdAt);
    if ('updatedAt' in r) r.updatedAt = toDate(r.updatedAt);
  } else if (table === 'Delivery') {
    if ('createdAt' in r) r.createdAt = toDate(r.createdAt);
    if ('updatedAt' in r) r.updatedAt = toDate(r.updatedAt);
  }
  return r;
}

function matchesOperator(rowVal: any, opObj: any): boolean {
  for (const op of Object.keys(opObj)) {
    const val = opObj[op];
    if (op === 'in') {
      if (!Array.isArray(val)) return false;
      // handle Date comparison for in?
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
      // check if it's operator object
      const ops = Object.keys(cond);
      const isOperator = ops.some(op => ['in', 'notIn', 'gte', 'lte', 'gt', 'lt', 'contains', 'startsWith', 'endsWith'].includes(op));
      if (isOperator) {
        if (!matchesOperator(rowVal, cond)) return false;
      } else {
        // nested where? For simplicity treat as equality check for object
        // Could be { id: { in: [...] } } already handled, else direct compare
        if (!matchesWhere(rowVal || {}, cond)) return false;
      }
    } else {
      // direct equality, handle Date
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

// Generic table handler
class Table<T> {
  constructor(private name: string) {}

  private allRows(): any[] {
    try {
      const rows = db.prepare(`SELECT * FROM "${this.name}"`).all() as any[];
      return rows.map(r => convertRow(this.name, r));
    } catch (e) {
      // console.error(`[${this.name}] allRows error`, e);
      return [];
    }
  }

  async findMany(args: any = {}): Promise<any[]> {
    let rows = this.allRows();
    if (args.where) {
      rows = rows.filter(r => matchesWhere(r, args.where));
    }
    if (args.orderBy) {
      rows = applyOrderBy(rows, args.orderBy);
    }
    if (args.select) {
      rows = rows.map(r => filterSelect(r, args.select));
    }
    // include handling
    if (args.include) {
      rows = await this.applyInclude(rows, args.include);
    }
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
    const row: any = {
      id,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    // Handle booleans to int
    if (this.name === 'Customer') {
      if ('phoneValid' in row) row.phoneValid = row.phoneValid ? 1 : 0;
      if ('optInWhatsApp' in row) row.optInWhatsApp = row.optInWhatsApp ? 1 : 0;
      if (row.acquiredAt instanceof Date) row.acquiredAt = row.acquiredAt.toISOString();
    }
    if (row.createdAt instanceof Date) row.createdAt = row.createdAt.toISOString();
    if (row.updatedAt instanceof Date) row.updatedAt = row.updatedAt.toISOString();
    if (row.lastSyncedAt instanceof Date) row.lastSyncedAt = row.lastSyncedAt.toISOString();

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

    // handle increment
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (v && typeof v === 'object' && 'increment' in v) {
        updated[k] = (existing[k] || 0) + v.increment;
      }
    }

    // convert for storage
    const storage: any = { ...updated };
    if (this.name === 'Customer') {
      if ('phoneValid' in storage) storage.phoneValid = storage.phoneValid ? 1 : 0;
      if ('optInWhatsApp' in storage) storage.optInWhatsApp = storage.optInWhatsApp ? 1 : 0;
      if (storage.acquiredAt instanceof Date) storage.acquiredAt = storage.acquiredAt.toISOString();
    }
    if (storage.createdAt instanceof Date) storage.createdAt = storage.createdAt.toISOString();
    if (storage.updatedAt instanceof Date) storage.updatedAt = storage.updatedAt.toISOString();
    if (storage.lastSyncedAt instanceof Date) storage.lastSyncedAt = storage.lastSyncedAt.toISOString();

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
    // Campaign include template, deliveries
    // Delivery include customer
    // Customer include deliveries? not used
    // SheetSource include customers? not used
    const result = [...rows];
    if (this.name === 'Campaign' && include.template) {
      const templateTable = new Table('MessageTemplate');
      for (const r of result) {
        if (r.templateId) {
          const t = await templateTable.findUnique({ where: { id: r.templateId } });
          (r as any).template = t;
        } else {
          (r as any).template = null;
        }
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
    if (this.name === 'Delivery' && include.campaign) {
      const campTable = new Table('Campaign');
      for (const r of result) {
        const c = await campTable.findUnique({ where: { id: r.campaignId } });
        (r as any).campaign = c;
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
  $connect: async () => {},
  $disconnect: async () => {
    try { db.close(); } catch {}
  },
};

export async function ensurePrismaConnected() {
  try { await prisma.$connect(); } catch {}
}
