import crypto from 'crypto';
import { WhatsAppProvider, SendTemplateParams, SendTextParams, SendResult } from './WhatsAppProvider.js';
import { config } from '../../config/index.js';
import { prisma } from '../../repositories/prisma.js';

export class CloudApiProvider implements WhatsAppProvider {
  readonly name = 'cloud-api' as const;
  private base = 'https://graph.facebook.com/v21.0'; // verified Aug 2025 - v21.0 current; fallback v20.0

  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    const url = `${this.base}/${config.whatsapp.phoneNumberId}/messages`;
    const payload: any = {
      messaging_product: 'whatsapp',
      to: params.toE164.replace('+',''),
      type: 'template',
      template: {
        name: params.templateName,
        language: { code: params.locale },
        components: params.variables.length ? [{ type:'body', parameters: params.variables.map(text=>({type:'text', text})) }] : []
      }
    };
    return this.post(url, payload);
  }

  async sendText(params: SendTextParams): Promise<SendResult> {
    const url = `${this.base}/${config.whatsapp.phoneNumberId}/messages`;
    const payload:any = {
      messaging_product: 'whatsapp',
      to: params.toE164.replace('+',''),
      type: 'text',
      text: { preview_url: false, body: params.body }
    };
    return this.post(url, payload);
  }

  private async post(url:string, payload:any): Promise<SendResult> {
    const res = await fetch(url, {
      method:'POST',
      headers:{
        'Authorization': `Bearer ${config.whatsapp.accessToken}`,
        'Content-Type':'application/json'
      },
      body: JSON.stringify(payload)
    });
    const json:any = await res.json().catch(()=> ({}));
    if (!res.ok) {
      const err = json?.error?.message || `HTTP ${res.status}`;
      console.error('[whatsapp] send failed', err, json);
      return { providerMessageId: '', status:'failed', error: err };
    }
    const wamid = json?.messages?.[0]?.id || json?.id || `wamid.${Date.now()}`;
    return { providerMessageId: wamid, status:'sent' };
  }

  verifyWebhook(mode:string, token:string, challenge:string) {
    if (mode==='subscribe' && token===config.whatsapp.verifyToken) {
      return { ok:true, challenge };
    }
    return { ok:false };
  }

  // Handle Cloud API status webhooks: verify signature if app secret configured
  async handleStatusWebhook(payload:any) {
    // payload.entry[0].changes[0].value.statuses
    try {
      const entries = payload.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const value = change.value;
          if (!value) continue;
          const statuses = value.statuses || [];
          for (const s of statuses) {
            const wamid = s.id;
            const status = s.status; // sent, delivered, read, failed
            const errors = s.errors;
            const mapped = mapStatus(status);
            if (!wamid) continue;
            await prisma.delivery.updateMany({
              where: { providerMessageId: wamid },
              data: { status: mapped, error: errors ? JSON.stringify(errors) : null }
            });
          }
        }
        // inbound messages could be handled here too
      }
    } catch (e) { console.error('[whatsapp] webhook handle error', e); }
  }

  verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!config.whatsapp.appSecret) return true; // if not configured, skip
    if (!signatureHeader) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', config.whatsapp.appSecret).update(rawBody).digest('hex');
    // timingSafeEqual
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
    } catch { return false; }
  }
}

function mapStatus(s:string): string {
  if (['sent','delivered','read','failed'].includes(s)) return s;
  if (s==='queued') return 'queued';
  return s;
}
