import { prisma } from './repositories/prisma.js';
import { config } from './config/index.js';

async function main() {
  await prisma.$connect();
  console.log('Seeding templates ...');
  const ct = await prisma.messageTemplate.count();
  if (ct===0) {
    await prisma.messageTemplate.createMany({
      data: [
        {
          name: 'Re-engagement — Warm Return (10%)',
          body: 'Hi {{name}} — we miss you at {{brand}}! It’s been a little while. Here’s {{discount}} off your next visit — we’d love to see you again. Reply YES to claim.',
          variables: JSON.stringify([{key:'1', mappedTo:'name'},{key:'2', mappedTo:'discount'},{key:'3', mappedTo:'brand'}]),
          whatsappTemplateName: config.whatsapp.templateName || 'reengagement_offer',
          locale: 'en_US',
          status: 'approved',
        }
      ]
    });
  }
  const customers = await prisma.customer.count();
  console.log(`Customers: ${customers} (no mock data, sheet-only)`);
}

main().catch(e=>{ console.error(e); process.exit(1)}).finally(()=> prisma.$disconnect());
