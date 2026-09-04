import { SheetsClient } from './SheetsClient.js';
import { PublicCsvSheetsClient } from './PublicCsvSheetsClient.js';
import { ServiceAccountSheetsClient } from './ServiceAccountSheetsClient.js';
import { config } from '../../config/index.js';

export * from './SheetsClient.js';
export { PublicCsvSheetsClient } from './PublicCsvSheetsClient.js';
export { ServiceAccountSheetsClient } from './ServiceAccountSheetsClient.js';

/**
 * Try public path first (zero-config), then service account.
 * No mock fallback - sheet-only, real data only.
 */
export async function getSheetsClientForUrl(url: string): Promise<{ client: SheetsClient; mode: 'public'|'service-account' }> {
  const pub = new PublicCsvSheetsClient();
  return { client: pub, mode: 'public' };
}

export function getServiceAccountClientIfConfigured(): SheetsClient | null {
  if (!config.isSheetServiceAccountConfigured()) return null;
  return new ServiceAccountSheetsClient();
}

// Composite that tries public then service-account - no mock
export class CompositeSheetsClient implements SheetsClient {
  async fetchSheet(url: string) {
    const pub = new PublicCsvSheetsClient();
    try {
      return await pub.fetchSheet(url);
    } catch (e:any) {
      // try service account if configured
      const sa = getServiceAccountClientIfConfigured();
      if (sa) {
        try { return await sa.fetchSheet(url); } catch (e2) { /* fallthrough */ }
      }
      throw e;
    }
  }
  async testConnection(url: string) {
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
