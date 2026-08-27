import { prisma } from './repositories/prisma.js';
import { MockSheetsClient } from './integrations/sheets/MockSheetsClient.js';
import { ingestSheet } from './services/ingestService.js';
import { config } from './config/index.js';

async function main() {
  await prisma.$connect();
  console.log('Seeding mock sheet + templates ...');
  // Seed templates via index.ts ensureSeed but also do here
  const ct = await prisma.messageTemplate.count();
  if (ct===0) {
    await prisma.messageTemplate.createMany({
      data: [
        {
          name: 'Re-engagement — Warm Return (10%)',
          body: 'Hi {{name}} — we miss you at {{brand}}! It’s been a little while. Here’s {{discount}} off your next visit — we’d love to see you again. Reply YES to claim.',
          variables: JSON.stringify([{key:'1', mappedTo:'name'},{key:'2', mappedTo:'discount'}]),
          whatsappTemplateName: config.whatsapp.templateName || 'reengagement_offer',
          locale: 'en_US',
          status: 'approved',
        }
      ]
    });
  }
  // Ingest mock
  const result = await ingestSheet('mock://demo');
  console.log('Ingest result', result);
  const customers = await prisma.customer.count();
  console.log(`Customers: ${customers}`);
}

main().catch(e=>{ console.error(e); process.exit(1)}).finally(()=> prisma.$disconnect());
