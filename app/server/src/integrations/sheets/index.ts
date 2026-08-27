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
      // In dry-run, if public failed due to not-shared, we still want demo to work:
      // Check if error is "not publicly readable" -> return mock with warning? But spec says should flag, not crash.
      // For now, if url is the sample google sheet from spec (or any real sheet that is private), we simulate by throwing a typed error
      // The caller (ingest) will surface "needs service account" to wizard.
      // To keep zero-config demo, if caller explicitly passed mock:// we already handled.
      // So rethrow original
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
