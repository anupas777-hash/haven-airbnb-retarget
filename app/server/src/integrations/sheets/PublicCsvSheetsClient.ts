import { SheetsClient, SheetData, extractSheetId, toCsvExportUrl, toGvizUrl } from './SheetsClient.js';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i=0;i<text.length;i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i+1]==='"') { cur+='"'; i++; }
      else inQuotes=!inQuotes;
    } else if (c===',' && !inQuotes) {
      row.push(cur); cur='';
    } else if ((c==='\n' || c==='\r') && !inQuotes) {
      if (c==='\r' && text[i+1]==='\n') i++;
      row.push(cur); cur='';
      // avoid pushing empty trailing rows
      if (row.some(v=>v.trim()!=='')) rows.push(row);
      row=[];
    } else {
      cur+=c;
    }
  }
  if (cur!=='' || row.length>0) { row.push(cur); rows.push(row); }
  // Filter out completely empty rows
  return rows.filter(r=>r.some(v=>v.trim()!==''));
}

export class PublicCsvSheetsClient implements SheetsClient {
  async fetchSheet(url: string): Promise<SheetData> {
    const sheetId = extractSheetId(url);
    if (!sheetId) throw new Error('Invalid Google Sheet URL — could not extract sheet ID');
    // Try multiple endpoints
    const candidates = [
      toCsvExportUrl(sheetId),
      toGvizUrl(sheetId),
      // also try with gid extraction if present
      ...(() => {
        const gidMatch = url.match(/[#&]gid=(\d+)/);
        return gidMatch ? [toCsvExportUrl(sheetId, gidMatch[1])] : [];
      })()
    ];
    let lastError: any = null;
    for (const endpoint of candidates) {
      try {
        const res = await fetch(endpoint, { redirect: 'follow' });
        if (!res.ok) { lastError = new Error(`HTTP ${res.status} from ${endpoint}`); continue; }
        const text = await res.text();
        // Heuristic: if returned HTML, not CSV
        if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
          lastError = new Error('Sheet is not publicly readable — returned HTML (needs sharing or service account)');
          continue;
        }
        const rawRows = parseCsv(text);
        if (rawRows.length < 1) { lastError = new Error('Empty sheet or no rows'); continue; }
        const headers = rawRows[0].map(h=>h.trim());
        const rows: Record<string,string>[] = rawRows.slice(1).map(r=>{
          const obj: Record<string,string> = {};
          headers.forEach((h,i)=> obj[h]= (r[i] ?? '').trim());
          return obj;
        });
        // Title fallback to sheetId
        return { title: `Sheet ${sheetId.slice(0,8)}`, headers, rows, rawRows };
      } catch (e: any) {
        // Preserve original fetch error details
        const msg = e?.message || String(e);
        if (msg.includes('fetch failed') || msg.includes('SSL_ERROR') || msg.includes('network')) {
          lastError = new Error(`Network blocked — cannot reach Google Sheets from this sandbox (fetch failed). Try on your local localhost, or use mock://demo for demo data. Original: ${msg}`);
        } else {
          lastError = e;
        }
      }
    }
    throw lastError || new Error('Failed to fetch sheet via public path');
  }

  async testConnection(url: string): Promise<{ ok: boolean; title?: string; error?: string }> {
    try {
      const data = await this.fetchSheet(url);
      return { ok: true, title: data.title };
    } catch (e:any) {
      return { ok: false, error: e.message };
    }
  }
}
