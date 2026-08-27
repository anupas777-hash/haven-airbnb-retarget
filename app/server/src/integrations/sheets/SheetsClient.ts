export type SheetData = {
  title: string;
  headers: string[];
  rows: Record<string, string>[];
  rawRows: string[][]; // for debugging
};

export interface SheetsClient {
  fetchSheet(url: string): Promise<SheetData>;
  testConnection(url: string): Promise<{ ok: boolean; title?: string; error?: string }>;
}

export function extractSheetId(url: string): string | null {
  // https://docs.google.com/spreadsheets/d/{id}/edit ...
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  // maybe already id
  if (/^[a-zA-Z0-9-_]{20,}$/.test(url.trim())) return url.trim();
  return null;
}

export function toCsvExportUrl(sheetId: string, gid?: string): string {
  // public CSV export via /export?format=csv
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  return gid ? `${base}&gid=${gid}` : base;
}

export function toGvizUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
}
