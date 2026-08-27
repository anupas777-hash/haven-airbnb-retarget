import { WhatsAppProvider, SendTemplateParams, SendTextParams, SendResult } from './WhatsAppProvider.js';
import { prisma } from '../../repositories/prisma.js';

/**
 * Dry-run provider: simulates realistic delivery callbacks.
 * Queued -> sent -> delivered -> read (or failed 5% randomly deterministic by phone)
 */
export class ConsoleProvider implements WhatsAppProvider {
  readonly name = 'console' as const;

  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    const id = `dry_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    console.log(`[dry-run] sendTemplate to ${params.toE164} template=${params.templateName} vars=${JSON.stringify(params.variables)} id=${id}`);
    // Simulate async status progression in background
    this.simulateProgress(params.campaignId, params.customerId, id, params.toE164);
    return { providerMessageId: id, status: 'queued' };
  }
  async sendText(params: SendTextParams): Promise<SendResult> {
    const id = `dry_text_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    console.log(`[dry-run] sendText to ${params.toE164} body="${params.body.slice(0,60)}" id=${id}`);
    this.simulateProgress(params.campaignId, params.customerId, id, params.toE164);
    return { providerMessageId: id, status: 'queued' };
  }

  private simulateProgress(campaignId: string, customerId: string, providerId: string, to: string) {
    // Deterministic failure for invalid phones that slipped through? We'll mark 5% as failed based on last digit
    const shouldFail = to.endsWith('9'); // ~10% deterministic
    const steps: Array<{status:string, delay:number}> = shouldFail
      ? [{status:'sent', delay:400}, {status:'failed', delay:900}]
      : [{status:'sent', delay:400}, {status:'delivered', delay:900}, {status:'read', delay:1600}];
    let idx=0;
    const tick = async () => {
      if (idx>=steps.length) return;
      const s = steps[idx++];
      await new Promise(r=>setTimeout(r,s.delay));
      try {
        await prisma.delivery.updateMany({
          where: { campaignId, customerId },
          data: { status: s.status, providerMessageId: providerId, error: s.status==='failed' ? 'Simulated carrier failure (dry-run)' : null, attempt: idx }
        });
        console.log(`[dry-run] delivery ${campaignId}/${customerId} -> ${s.status}`);
      } catch {}
      tick();
    };
    tick();
  }

  verifyWebhook(mode: string, token: string, challenge: string) {
    // console provider always ok for test
    return { ok: mode==='subscribe' && !!challenge, challenge };
  }
  async handleStatusWebhook(_payload:any) { /* no-op */ }
}
