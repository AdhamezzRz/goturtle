import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../../config';
import {
  ConsoleProvider, ResendProvider, SendGridProvider, SmsMisrProvider, TwilioProvider, VictoryLinkProvider, WhatsAppCloudProvider,
} from './implementations';
import type { EmailProvider, SmsProvider, WhatsAppProvider } from './types';

const SMS: Record<string, () => SmsProvider> = {
  console: () => new ConsoleProvider(),
  twilio: () => new TwilioProvider(),
  smsmisr: () => new SmsMisrProvider(),
  victorylink: () => new VictoryLinkProvider(),
};
const WHATSAPP: Record<string, () => WhatsAppProvider> = {
  console: () => new ConsoleProvider(),
  whatsapp_cloud: () => new WhatsAppCloudProvider(),
  twilio: () => new TwilioProvider(),
};
const EMAIL: Record<string, () => EmailProvider> = {
  console: () => new ConsoleProvider(),
  resend: () => new ResendProvider(),
  sendgrid: () => new SendGridProvider(),
};

/**
 * Picks the SMS / WhatsApp / e-mail provider from config.notifications.*
 * (SMS_PROVIDER, WHATSAPP_PROVIDER, EMAIL_PROVIDER). Unknown names fall back
 * to the console provider with a warning so a typo never takes the app down.
 */
@Injectable()
export class ProviderRegistry {
  private readonly log = new Logger('Notifications');
  private smsProvider: SmsProvider;
  private whatsappProvider: WhatsAppProvider;
  private emailProvider: EmailProvider;

  constructor() {
    this.smsProvider = this.pick('SMS_PROVIDER', SMS, config.notifications.sms);
    this.whatsappProvider = this.pick('WHATSAPP_PROVIDER', WHATSAPP, config.notifications.whatsapp);
    this.emailProvider = this.pick('EMAIL_PROVIDER', EMAIL, config.notifications.email);
  }

  sms(): SmsProvider {
    return this.smsProvider;
  }

  whatsapp(): WhatsAppProvider {
    return this.whatsappProvider;
  }

  email(): EmailProvider {
    return this.emailProvider;
  }

  /** Swap providers at runtime (tests, or a future admin "switch gateway" action). */
  use(p: { sms?: SmsProvider; whatsapp?: WhatsAppProvider; email?: EmailProvider }) {
    if (p.sms) this.smsProvider = p.sms;
    if (p.whatsapp) this.whatsappProvider = p.whatsapp;
    if (p.email) this.emailProvider = p.email;
  }

  private pick<T>(env: string, table: Record<string, () => T>, name: string): T {
    const key = (name || 'console').toLowerCase();
    const factory = table[key];
    if (!factory) {
      this.log.warn(`${env}=${name} is not supported (use one of ${Object.keys(table).join(', ')}) — falling back to console`);
      return table.console();
    }
    if (config.isProd && key === 'console') this.log.warn(`${env} is "console": messages are only logged, not delivered`);
    return factory();
  }
}
