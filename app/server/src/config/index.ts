import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  databaseUrl: process.env.DATABASE_URL || 'file:./prisma/dev.db',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  brandName: process.env.BRAND_NAME || 'Your Brand',
  defaultDiscountPercent: parseInt(process.env.DEFAULT_DISCOUNT_PERCENT || '10', 10),
  accessGateToken: process.env.ACCESS_GATE_TOKEN || '',
  google: {
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    privateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    keyJson: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON || '',
  },
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'retarget_verify_token_change_me',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    templateName: process.env.WHATSAPP_TEMPLATE_NAME || 'reengagement_offer',
    templateLocale: process.env.WHATSAPP_TEMPLATE_LOCALE || 'en_US',
  },
  queue: {
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
    ratePerSecond: parseInt(process.env.QUEUE_RATE_PER_SECOND || '2', 10),
  },
  isDryRun(): boolean {
    return !this.whatsapp.phoneNumberId || !this.whatsapp.accessToken;
  },
  isSheetServiceAccountConfigured(): boolean {
    return !!(this.google.serviceAccountEmail && (this.google.privateKey || this.google.keyJson));
  }
};

export const DEFAULT_COHORT_RULE = {
  type: 'lastNDays' as const,
  days: 37,
  fromDaysAgo: 37,
  toDaysAgo: 30,
  // actually default window: 30-37 days ago -> acquired in last 37 days but not in last 30? Wait spec says default last 30 days (use 30-37 to catch ~30 day mark)
  // Interpret as: acquired between 30 and 37 days ago inclusive
};

export const COHORT_DEFAULT = {
  type: 'lastNDays' as const,
  fromDaysAgo: 37,
  toDaysAgo: 30,
};

export const LOGICAL_FIELDS = ['name','phone','acquired_at','rating','comment','opt_in_whatsapp','email'] as const;
