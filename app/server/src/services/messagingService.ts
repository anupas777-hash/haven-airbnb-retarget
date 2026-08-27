import { prisma } from '../repositories/prisma.js';
import { getWhatsAppProvider } from '../integrations/whatsapp/index.js';
import { messagingQueue } from '../queue/index.js';
import { interpolateTemplate } from 'shared';
import { resolveSelectionCustomerIds } from './campaignService.js';

function renderBody(templateBody: string, customer: any, discountPercent: number, brandName: string): string {
  const vars: Record<string,string> = {
    name: customer.name?.split(' ')[0] || customer.name,
    fullName: customer.name,
    discount: `${discountPercent}%`,
    brand: brandName,
    '1': customer.name?.split(' ')[0] || customer.name,
    '2': `${discountPercent}%`,
  };
  // Support {{name}}, {{discount}}, {{brand}}, {{1}}, {{2}}
  return interpolateTemplate(templateBody, vars);
}

export async function sendCampaign(campaignId: string, brandName: string): Promise<{ enqueued: number; skipped: number; failures: Array<{customerId:string; reason:string}> }> {
  const campaign = await prisma.campaign.findUnique({ where:{ id: campaignId }, include:{ template:true }});
  if (!campaign) throw { code:'NOT_FOUND', message:'Campaign not found' };

  const customerIds = await resolveSelectionCustomerIds(campaign as any);
  if (customerIds.length===0) throw { code:'NO_RECIPIENTS', message:'No recipients selected' };

  const customers = await prisma.customer.findMany({ where:{ id:{ in: customerIds }}});

  const templateBody = (campaign.template as any)?.body || `Hi {{name}} — we miss you at ${brandName}! Here's {{discount}} off your next visit. Reply to book.`;
  const templateName = (campaign.template as any)?.whatsappTemplateName || 'reengagement_offer';
  const locale = (campaign.template as any)?.locale || 'en_US';

  let enqueued=0, skipped=0;
  const failures: Array<{customerId:string; reason:string}> = [];

  // Ensure Delivery rows exist (idempotent unique(campaignId,customerId))
  for (const c of customers) {
    // validation: phone valid (opt-in removed per request)
    // if (!c.optInWhatsApp) { skipped++; failures.push({customerId:c.id, reason:'Not opted-in'}); continue; }
    if (!c.phoneValid || !c.phoneE164) { skipped++; failures.push({customerId:c.id, reason:'Invalid phone'}); continue; }
    if (!c.acquiredAt) { skipped++; failures.push({customerId:c.id, reason:'Missing acquired date'}); continue; }

    // Upsert delivery
    let delivery = await prisma.delivery.findUnique({ where:{ campaignId_customerId:{ campaignId, customerId:c.id }}});
    if (delivery && ['delivered','read','sent'].includes(delivery.status)) {
      // already delivered/sent -> skip idempotent
      skipped++;
      continue;
    }
    if (!delivery) {
      delivery = await prisma.delivery.create({ data:{ campaignId, customerId:c.id, status:'queued', attempt:0 }});
    } else {
      // reset failed/queued to re-queue
      await prisma.delivery.update({ where:{ id: delivery.id }, data:{ status:'queued', error: null }});
    }

    // Enqueue send with retry
    const provider = getWhatsAppProvider();
    const vars = [c.name.split(' ')[0] || c.name, `${campaign.discountPercent}%`];
    const body = renderBody(templateBody, c, campaign.discountPercent, brandName);

    messagingQueue.add({
      id: `${campaignId}:${c.id}`,
      run: async () => {
        try {
          await prisma.delivery.update({ where:{ id: delivery!.id }, data:{ status:'queued', attempt: { increment:1 } }});
          // Decide template vs text: if template exists and status approved, use template; else fallback
          // In dry-run, always simulate template
          const isTemplate = !!(campaign.templateId);
          const res = isTemplate
            ? await provider.sendTemplate({ toE164: c.phoneE164!, templateName, locale, variables: vars, customerId: c.id, campaignId })
            : await provider.sendText({ toE164: c.phoneE164!, body, customerId: c.id, campaignId });

          if (res.status==='failed') {
            await prisma.delivery.update({ where:{ id: delivery!.id }, data:{ status:'failed', error: res.error }});
          } else {
            await prisma.delivery.update({ where:{ id: delivery!.id }, data:{ status: res.status, providerMessageId: res.providerMessageId, error: res.error || null }});
          }
        } catch (e:any) {
          await prisma.delivery.update({ where:{ id: delivery!.id }, data:{ status:'failed', error: e.message }});
        }
      }
    });
    enqueued++;
  }

  await prisma.campaign.update({ where:{ id: campaignId }, data:{ status: 'sending' }});

  // Background monitor to mark completed when queue drains
  (async () => {
    await messagingQueue.onIdle();
    // check if all deliveries are terminal
    const remaining = await prisma.delivery.count({ where:{ campaignId, status:{ in:['queued','sent'] }}});
    if (remaining===0) {
      const failed = await prisma.delivery.count({ where:{ campaignId, status:'failed' }});
      await prisma.campaign.update({ where:{ id: campaignId }, data:{ status: failed>0 ? 'completed' : 'completed' }});
    }
  })();

  return { enqueued, skipped, failures };
}

export async function retryDelivery(campaignId: string, customerId: string, brandName: string) {
  const delivery = await prisma.delivery.findUnique({ where:{ campaignId_customerId:{ campaignId, customerId }}});
  if (!delivery) throw { code:'NOT_FOUND', message:'Delivery not found' };
  const campaign = await prisma.campaign.findUnique({ where:{ id: campaignId }, include:{ template:true }});
  if (!campaign) throw { code:'NOT_FOUND', message:'Campaign not found' };
  const customer = await prisma.customer.findUnique({ where:{ id: customerId }});
  if (!customer) throw { code:'NOT_FOUND', message:'Customer not found' };

  await prisma.delivery.update({ where:{ id: delivery.id }, data:{ status:'queued', error:null }});
  // enqueue single
  const provider = getWhatsAppProvider();
  const vars = [customer.name.split(' ')[0] || customer.name, `${campaign.discountPercent}%`];
  const templateBody = (campaign.template as any)?.body || `Hi {{name}} — we miss you! Here's {{discount}} off.`;
  const body = renderBody(templateBody, customer, campaign.discountPercent, brandName);
  const templateName = (campaign.template as any)?.whatsappTemplateName || 'reengagement_offer';
  const locale = (campaign.template as any)?.locale || 'en_US';
  messagingQueue.add({
    id: `${campaignId}:${customerId}:retry:${Date.now()}`,
    run: async () => {
      const isTemplate = !!(campaign.templateId);
      const res = isTemplate
        ? await provider.sendTemplate({ toE164: customer.phoneE164!, templateName, locale, variables: vars, customerId, campaignId })
        : await provider.sendText({ toE164: customer.phoneE164!, body, customerId, campaignId });
      await prisma.delivery.update({ where:{ id: delivery.id }, data:{ status: res.status, providerMessageId: res.providerMessageId, error: res.error||null, attempt:{ increment:1 } }});
    }
  });
  return { ok:true };
}

export function previewMessage(templateBody: string, customer: any, discountPercent: number, brandName: string): string {
  return renderBody(templateBody, customer, discountPercent, brandName);
}
