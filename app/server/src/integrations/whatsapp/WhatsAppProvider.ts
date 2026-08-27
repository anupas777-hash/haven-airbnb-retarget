export type SendTemplateParams = {
  toE164: string;
  templateName: string;
  locale: string;
  variables: string[]; // ordered {{1}}, {{2}} ...
  customerId: string;
  campaignId: string;
};

export type SendTextParams = {
  toE164: string;
  body: string;
  customerId: string;
  campaignId: string;
};

export type SendResult = {
  providerMessageId: string;
  status: 'queued'|'sent'|'failed';
  error?: string;
};

export interface WhatsAppProvider {
  readonly name: 'console'|'cloud-api';
  sendTemplate(params: SendTemplateParams): Promise<SendResult>;
  sendText(params: SendTextParams): Promise<SendResult>;
  verifyWebhook?(mode: string, token: string, challenge: string): { ok: boolean; challenge?: string };
  handleStatusWebhook?(payload: any): Promise<void>;
}
