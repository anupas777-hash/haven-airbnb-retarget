import { google } from 'googleapis';
import { SheetsClient, SheetData, extractSheetId } from './SheetsClient.js';
import { config } from '../../config/index.js';

export class ServiceAccountSheetsClient implements SheetsClient {
  private getAuth() {
    let credentials: any = null;
    if (config.google.keyJson) {
      try { credentials = JSON.parse(config.google.keyJson); } catch {}
    }
    if (!credentials && config.google.serviceAccountEmail && config.google.privateKey) {
      credentials = {
        client_email: config.google.serviceAccountEmail,
        private_key: config.google.privateKey,
      };
    }
    if (!credentials) throw new Error('Service account not configured');
    return new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  }

  async fetchSheet(url: string): Promise<SheetData> {
    const sheetId = extractSheetId(url);
    if (!sheetId) throw new Error('Invalid sheet URL');
    const auth = this.getAuth();
    await auth.authorize();
    const sheets = google.sheets({ version: 'v4', auth });

    // Get spreadsheet metadata for title
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const title = meta.data.properties?.title || `Sheet ${sheetId.slice(0,8)}`;
    const firstSheet = meta.data.sheets?.[0]?.properties?.title || 'Sheet1';

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${firstSheet}`,
    });
    const values: string[][] = (res.data.values as string[][]) || [];
    if (values.length < 1) throw new Error('Sheet is empty');
    const headers = values[0].map(h=>String(h).trim());
    const rows: Record<string,string>[] = values.slice(1).map(r=>{
      const obj: Record<string,string> = {};
      headers.forEach((h,i)=> obj[h]=String(r[i] ?? '').trim());
      return obj;
    });
    return { title, headers, rows, rawRows: values };
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
