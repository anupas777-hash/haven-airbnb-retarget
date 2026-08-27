import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
import { config } from './config/index.js';
import { router } from './http/routes.js';
import { requestId, errorHandler, corsWithConfig, accessGate } from './http/middleware.js';
import { prisma } from './repositories/prisma.js';

const app = express();

// Middleware
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin, credentials: true }));
app.use(express.json({ limit:'2mb' }));
app.use(express.urlencoded({ extended:true }));
app.use(requestId);
app.use(corsWithConfig);
app.use(accessGate);

// API routes
app.use('/api', router);

// Serve health at root too
app.get('/health', (_req,res)=> res.json({ ok:true }));

// Error handler last
app.use(errorHandler);

const port = config.port;

async function start() {
  try {
    await prisma.$connect();
    console.log('[server] DB connected');
    // ensure seed templates
    await ensureSeed();
  } catch (e) {
    console.error('[server] DB connect failed', e);
  }
  app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}  mode=${config.isDryRun()?'dry-run':'live'}`);
    if (config.isDryRun()) {
      console.log('[server] Dry-run enabled — WhatsApp sends are simulated. Set WHATSAPP_* env to go live.');
    }
  });
}

const DEFAULT_TEMPLATES = [
  {
    name: 'Re-engagement — Warm Return (10%)',
    body: 'Hi {{name}} — we miss you at {{brand}}! It’s been a little while. Here’s {{discount}} off your next stay — we’d love to host you again. Reply YES to claim.',
    whatsappTemplateName: 'reengagement_offer',
  },
  {
    name: 'Re-engagement — Short Nudge',
    body: 'Hey {{name}}, quick nudge from {{brand}} — your {{discount}} return offer is waiting. Shall we hold your dates?',
    whatsappTemplateName: 'reengagement_nudge',
  },
  {
    name: 'VIP — Exclusive 20% Back',
    body: 'Hi {{name}}, you’re one of our favourite guests at {{brand}} 🌟 Enjoy {{discount}} off as a VIP thank-you — valid for 7 days. Tap to redeem: Reply VIP.',
    whatsappTemplateName: 'vip_comeback_20',
  },
  {
    name: 'New Listing / New Property',
    body: 'Hi {{name}} — something new at {{brand}} just for you! Discover our newest stay and enjoy {{discount}} off your next booking. Want a preview? Reply NEW.',
    whatsappTemplateName: 'new_arrivals_offer',
  },
  {
    name: 'We Miss You — Feedback + Offer',
    body: 'Hi {{name}}, it’s been a while since you stayed with {{brand}}. We’d love your feedback — and here’s {{discount}} off to welcome you back. Reply FEEDBACK.',
    whatsappTemplateName: 'feedback_offer',
  },
  {
    name: 'Last Chance — Limited Time',
    body: '⏰ Last chance, {{name}}! Your {{discount}} stay at {{brand}} expires in 48h. Don’t miss out — reply CLAIM to lock it in.',
    whatsappTemplateName: 'last_chance_offer',
  },
  {
    name: 'Refer a Friend — Give & Get',
    body: 'Love {{brand}}, {{name}}? Refer a friend and you both get {{discount}} off your next stay. Share: “Stay with {{brand}}” — reply REFER for your link.',
    whatsappTemplateName: 'refer_friend_offer',
  },
  {
    name: 'Birthday / Anniversary Special',
    body: 'Happy celebrations, {{name}} 🎉 {{brand}} has a treat: {{discount}} off your next getaway on us! Reply BDAY to redeem this month.',
    whatsappTemplateName: 'birthday_offer',
  },
  {
    name: 'Festive Seasonal Offer',
    body: 'Season’s greetings from {{brand}}, {{name}}! Enjoy {{discount}} off your festive getaway. Offer valid this week — reply FESTIVE.',
    whatsappTemplateName: 'festive_offer',
  },
  {
    name: 'Thank You — Review Request',
    body: 'Thanks for staying with {{brand}}, {{name}}! If you loved your stay, a quick review helps. As thanks, here’s {{discount}} off next time. Reply REVIEW.',
    whatsappTemplateName: 'review_request_offer',
  },
  {
    name: 'Abandoned Browse — We Saved Your Spot',
    body: 'Hi {{name}}, noticed you were eyeing a stay at {{brand}}. Still looking? Here’s {{discount}} off to book your dates. Reply YES.',
    whatsappTemplateName: 'browse_reminder_offer',
  },
];

async function ensureSeed() {
  try {
    for (const t of DEFAULT_TEMPLATES) {
      const exists = await prisma.messageTemplate.findUnique({ where: { name: t.name } });
      if (!exists) {
        await prisma.messageTemplate.create({
          data: {
            name: t.name,
            body: t.body,
            variables: JSON.stringify([{ key: '1', mappedTo: 'name' }, { key: '2', mappedTo: 'discount' }, { key: '3', mappedTo: 'brand' }]),
            whatsappTemplateName: t.whatsappTemplateName,
            locale: 'en_US',
            status: 'approved',
          },
        });
      } else if (exists.body !== t.body) {
        await prisma.messageTemplate.update({ where: { name: t.name }, data: { body: t.body, whatsappTemplateName: t.whatsappTemplateName } });
      }
    }
    console.log('[server] ensured templates:', DEFAULT_TEMPLATES.length);
  } catch (e) {
    console.warn('[server] seed failed', e);
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  start();
} else {
  // in test, just ensure seed without listening
  prisma.$connect().then(()=> ensureSeed()).catch(()=>{});
}

export default app;
export { start, ensureSeed };
