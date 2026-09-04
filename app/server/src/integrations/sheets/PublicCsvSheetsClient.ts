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
    // Try multiple endpoints - Google has several CSV export paths
    const gidMatch = url.match(/[#&]gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : undefined;
    const candidates = [
      toCsvExportUrl(sheetId, gid),
      toGvizUrl(sheetId),
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&id=${sheetId}${gid ? `&gid=${gid}` : ''}`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=Sheet1`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`,
      `https://docs.google.com/spreadsheets/d/e/2PACX-${sheetId}/pub?output=csv`,
    ];
    let lastError: any = null;
    for (const endpoint of candidates) {
      try {
        console.log(`[sheets] Trying ${endpoint}`);
        const res = await fetch(endpoint, {
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Haven Airbnb Retarget)',
            'Accept': 'text/csv, text/plain, */*',
          },
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          console.log(`[sheets] HTTP ${res.status} from ${endpoint}: ${txt.slice(0,200)}`);
          lastError = new Error(`HTTP ${res.status} from ${endpoint} — ${txt.slice(0,200)}`);
          continue;
        }
        const text = await res.text();
        // Heuristic: if returned HTML, not CSV
        if (text.trim().startsWith('<!DOCTYPE') || text.trim().toLowerCase().startsWith('<html')) {
          console.log(`[sheets] Got HTML from ${endpoint}, length ${text.length}`);
          lastError = new Error(`Sheet is not publicly readable — returned HTML (needs sharing as Anyone with link - Viewer). Got: ${text.slice(0,200)}`);
          continue;
        }
        // Check if it's actually an error page from Google
        if (text.includes('Google Sheets') && text.includes('Sign in')) {
          lastError = new Error('Google returned sign-in page — sheet is private, share as Anyone with link - Viewer');
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
        console.log(`[sheets] Success from ${endpoint}: ${rows.length} rows`);
        return { title: `Sheet ${sheetId.slice(0,8)}`, headers, rows, rawRows };
      } catch (e: any) {
        // Preserve original fetch error details
        const msg = e?.message || String(e);
        console.log(`[sheets] Fetch error from ${endpoint}: ${msg}`);
        if (msg.includes('fetch failed') || msg.includes('SSL_ERROR') || msg.includes('network') || msg.includes('ECONNREFUSED')) {
          lastError = new Error(`Network error — cannot reach Google Sheets (fetch failed). If you're in cloud preview, use mock://demo. On local, check internet. Original: ${msg}`);
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
