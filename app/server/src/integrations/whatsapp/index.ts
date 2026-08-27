import { WhatsAppProvider } from './WhatsAppProvider.js';
import { ConsoleProvider } from './ConsoleProvider.js';
import { CloudApiProvider } from './CloudApiProvider.js';
import { config } from '../../config/index.js';

export * from './WhatsAppProvider.js';

export function getWhatsAppProvider(): WhatsAppProvider {
  if (!config.isDryRun()) return new CloudApiProvider();
  return new ConsoleProvider();
}

export function isLive(): boolean {
  return !config.isDryRun();
}
