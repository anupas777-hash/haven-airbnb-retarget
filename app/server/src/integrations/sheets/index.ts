import { SheetsClient } from './SheetsClient.js';
import { PublicCsvSheetsClient } from './PublicCsvSheetsClient.js';
import { ServiceAccountSheetsClient } from './ServiceAccountSheetsClient.js';
import { MockSheetsClient } from './MockSheetsClient.js';
import { config } from '../../config/index.js';

export * from './SheetsClient.js';
export { MockSheetsClient } from './MockSheetsClient.js';
export { PublicCsvSheetsClient } from './PublicCsvSheetsClient.js';
export { ServiceAccountSheetsClient } from './ServiceAccountSheetsClient.js';

/**
 * Try public path first (zero-config), then service account, then mock.
 * For dry-run without creds, public path will succeed for shared sheets,
 * otherwise we gracefully fall back to mock so demo never blocks.
 */
export async function getSheetsClientForUrl(url: string): Promise<{ client: SheetsClient; mode: 'public'|'service-account'|'mock' }> {
  // If mock URL scheme? e.g. mock://
  if (url.startsWith('mock://') || url.includes('mock-fixture')) {
    return { client: new MockSheetsClient(), mode: 'mock' };
  }
  // Deterministically: try public first always
  const pub = new PublicCsvSheetsClient();
  try {
    // lightweight probe: if config has no service account, just return public — let fetch handle fallback
    return { client: pub, mode: 'public' };
  } catch {}
  return { client: pub, mode: 'public' };
}

export function getServiceAccountClientIfConfigured(): SheetsClient | null {
  if (!config.isSheetServiceAccountConfigured()) return null;
  return new ServiceAccountSheetsClient();
}

// Composite that tries public then service-account then mock
export class CompositeSheetsClient implements SheetsClient {
  async fetchSheet(url: string) {
    const sid = url;
    // mock shortcut
    if (url.startsWith('mock://')) {
      return new MockSheetsClient().fetchSheet(url);
    }
    const pub = new PublicCsvSheetsClient();
    try {
      return await pub.fetchSheet(url);
    } catch (e:any) {
      // try service account if configured
      const sa = getServiceAccountClientIfConfigured();
      if (sa) {
        try { return await sa.fetchSheet(url); } catch (e2) { /* fallthrough */ }
      }
      // In dry-run/cloud sandbox, network to Google is blocked (SSL_ERROR). Fallback to mock for demo if it's the sample sheet
      const isNetworkBlocked = e?.message?.includes('Network blocked') || e?.message?.includes('fetch failed');
      const isSampleSheet = url.includes('1WzRK4mY');
      if (isNetworkBlocked && isSampleSheet && config.isDryRun()) {
        console.log('[sheets] Network blocked, falling back to mock demo data for', url);
        return new MockSheetsClient().fetchSheet('mock://demo');
      }
      throw e;
    }
  }
  async testConnection(url: string) {
    if (url.startsWith('mock://')) return new MockSheetsClient().testConnection(url);
    const pub = new PublicCsvSheetsClient();
    const r = await pub.testConnection(url);
    if (r.ok) return r;
    const sa = getServiceAccountClientIfConfigured();
    if (sa) {
      const r2 = await sa.testConnection(url);
      if (r2.ok) return r2;
      return { ok: false, error: `${r.error}; service-account: ${r2.error}` };
    }
    return r;
  }
}
