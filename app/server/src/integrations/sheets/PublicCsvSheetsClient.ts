import { SheetsClient, SheetData, extractSheetId, toCsvExportUrl, toGvizUrl } from './SheetsClient.js';
import https from 'node:https';
import http from 'node:http';

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

function fetchViaHttps(url: string, timeoutMs = 15000): Promise<{ ok: boolean; status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/csv, text/plain, */*',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ ok: (res.statusCode||0) >=200 && (res.statusCode||0) <300, status: res.statusCode||0, text: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms fetching ${url}`));
    });
  });
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
    ];
    let lastError: any = null;
    for (const endpoint of candidates) {
      try {
        console.log(`[sheets] Trying ${endpoint}`);
        // Try native fetch first, fallback to https module
        let resOk = false;
        let status = 0;
        let text = '';
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 12000);
          const res = await fetch(endpoint, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/csv, text/plain, */*',
            },
          });
          clearTimeout(timeout);
          status = res.status;
          resOk = res.ok;
          text = await res.text();
        } catch (fetchErr: any) {
          console.log(`[sheets] fetch() failed, trying https module: ${fetchErr.message}`);
          // Fallback to https module
          try {
            const r = await fetchViaHttps(endpoint);
            status = r.status;
            resOk = r.ok;
            text = r.text;
          } catch (httpsErr: any) {
            throw new Error(`Both fetch and https failed: fetch=${fetchErr.message}, https=${httpsErr.message}`);
          }
        }

        if (!resOk) {
          console.log(`[sheets] HTTP ${status} from ${endpoint}: ${text.slice(0,300)}`);
          lastError = new Error(`HTTP ${status} from ${endpoint} — ${text.slice(0,300)}`);
          continue;
        }
        // Heuristic: if returned HTML, not CSV
        if (text.trim().startsWith('<!DOCTYPE') || text.trim().toLowerCase().startsWith('<html')) {
          console.log(`[sheets] Got HTML from ${endpoint}, length ${text.length}, snippet: ${text.slice(0,500)}`);
          // Check if it's Google login page
          if (text.includes('accounts.google.com') || text.includes('Sign in')) {
            lastError = new Error(`Sheet is private — Google returned sign-in page. Share as Anyone with link - Viewer. Snippet: ${text.slice(0,200)}`);
          } else {
            lastError = new Error(`Sheet returned HTML not CSV (might be private or wrong ID). Snippet: ${text.slice(0,200)}`);
          }
          continue;
        }
        const rawRows = parseCsv(text);
        if (rawRows.length < 1) { lastError = new Error('Empty sheet or no rows'); continue; }
        const headers = rawRows[0].map(h=>h.trim());
        if (headers.length < 2) {
          lastError = new Error(`Only ${headers.length} column found, expected at least 2. Got: ${headers.join(',')}. Raw: ${text.slice(0,500)}`);
          continue;
        }
        const rows: Record<string,string>[] = rawRows.slice(1).map(r=>{
          const obj: Record<string,string> = {};
          headers.forEach((h,i)=> obj[h]= (r[i] ?? '').trim());
          return obj;
        });
        console.log(`[sheets] Success from ${endpoint}: ${rows.length} rows, headers: ${headers.join(', ')}`);
        return { title: `Sheet ${sheetId.slice(0,8)}`, headers, rows, rawRows };
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.log(`[sheets] Error from ${endpoint}: ${msg}`);
        lastError = new Error(`Failed ${endpoint}: ${msg}`);
      }
    }
    throw lastError || new Error('Failed to fetch sheet via public path - all endpoints failed');
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
