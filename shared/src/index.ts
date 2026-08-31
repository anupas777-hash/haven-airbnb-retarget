import { z } from 'zod';

// ── Domain enums ──
export const SentimentLabelSchema = z.enum(['positive', 'neutral', 'negative']);
export type SentimentLabel = z.infer<typeof SentimentLabelSchema>;

export const DeliveryStatusSchema = z.enum(['queued', 'sent', 'delivered', 'read', 'failed']);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const CampaignStatusSchema = z.enum(['draft', 'queued', 'sending', 'completed', 'failed']);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

// ── Column mapping ──
export const LogicalFieldSchema = z.enum(['name','phone','acquired_at','rating','comment','opt_in_whatsapp','email','key_attributes']);
export type LogicalField = z.infer<typeof LogicalFieldSchema>;

export const ColumnMappingSchema = z.record(LogicalFieldSchema, z.string().nullable());
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

// ── Cohort rule ──
export const CohortRuleSchema = z.object({
  type: z.enum(['lastNDays', 'customRange']),
  days: z.number().int().min(1).max(365).optional(), // for lastNDays
  from: z.string().datetime().optional(), // ISO for customRange
  to: z.string().datetime().optional(),
  fromDaysAgo: z.number().int().optional(), // alternative window 30-37
  toDaysAgo: z.number().int().optional(),
});
export type CohortRule = z.infer<typeof CohortRuleSchema>;

// ── API Schemas ──
export const IngestSourceSchema = z.object({
  url: z.string().url(),
  mapping: ColumnMappingSchema.optional(),
});
export type IngestSourceInput = z.infer<typeof IngestSourceSchema>;

export const SyncSummarySchema = z.object({
  added: z.number(),
  updated: z.number(),
  skipped: z.number(),
  skippedReasons: z.array(z.object({ row: z.number(), reason: z.string() })),
  detectedMapping: ColumnMappingSchema,
  confidence: z.record(LogicalFieldSchema, z.number()),
  needsConfirmation: z.boolean(),
  sourceId: z.string(),
  title: z.string(),
});

export const CustomerQuerySchema = z.object({
  acquiredFromDays: z.coerce.number().int().optional(),
  acquiredToDays: z.coerce.number().int().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  maxRating: z.coerce.number().min(1).max(5).optional(),
  sentiment: z.union([z.string(), z.array(z.string())]).optional().transform(v => {
    if (!v) return undefined;
    const arr = Array.isArray(v) ? v : [v];
    return arr.flatMap(s => s.split(',')).filter(Boolean) as SentimentLabel[];
  }),
  search: z.string().optional(),
  optedInOnly: z.union([z.boolean(), z.string()]).optional().transform(v => {
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') {
      const l = v.toLowerCase().trim();
      if (l === 'false' || l === '0' || l === '') return false;
      if (l === 'true' || l === '1') return true;
      return false;
    }
    return !!v;
  }).default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional().default('acquiredAt:desc'),
  campaignId: z.string().optional(),
});
export type CustomerQuery = z.infer<typeof CustomerQuerySchema>;

export const CreateCampaignSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  cohortRule: CohortRuleSchema,
  discountPercent: z.number().min(1).max(90).default(10),
  templateId: z.string().optional(),
  filtersSnapshot: z.record(z.any()).optional(),
});
export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;

export const PatchCampaignSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  cohortRule: CohortRuleSchema.optional(),
  discountPercent: z.number().min(1).max(90).optional(),
  templateId: z.string().nullable().optional(),
  filtersSnapshot: z.record(z.any()).optional(),
  status: CampaignStatusSchema.optional(),
});

export const SelectionSchema = z.object({
  customerIds: z.array(z.string()).optional(),
  selectAllMatching: z.boolean().optional(),
  filters: CustomerQuerySchema.partial().optional(),
  deselectedIds: z.array(z.string()).optional(),
});
export type SelectionInput = z.infer<typeof SelectionSchema>;

export const TemplateSchema = z.object({
  name: z.string().min(1),
  body: z.string().min(1),
  variables: z.array(z.object({ key: z.string(), mappedTo: z.string() })),
  whatsappTemplateName: z.string().optional(),
  locale: z.string().default('en_US'),
  status: z.enum(['draft','approved','rejected']).default('draft'),
});

export const PreviewQuerySchema = z.object({
  customerId: z.string(),
  discountPercent: z.coerce.number().optional(),
  templateId: z.string().optional(),
});

export const SetupStatusSchema = z.object({
  mode: z.enum(['dry-run','live']),
  sheet: z.object({ configured: z.boolean(), canReadPublic: z.boolean(), serviceAccountEmail: z.string().nullable(), lastTest: z.string().nullable(), lastError: z.string().nullable() }),
  whatsapp: z.object({ configured: z.boolean(), canSend: z.boolean(), phoneNumberId: z.string().nullable(), lastTest: z.string().nullable(), lastError: z.string().nullable() }),
});

// ── Helpers ──
export function interpolateTemplate(body: string, vars: Record<string,string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export function maskPhone(e164: string): string {
  if (!e164) return '—';
  if (e164.length <= 4) return '••••';
  return e164.slice(0, -4).replace(/./g, '•') + e164.slice(-4);
}
