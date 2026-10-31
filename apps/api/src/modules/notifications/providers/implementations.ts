import { Logger } from '@nestjs/common';
import { fetchWithTimeout, requireEnv, snippet } from './http';
import {
  ProviderError, digitsOnly, egyptLocal, needsUnicode, retryableStatus,
  type EmailMessage, type EmailProvider, type SendResult, type SmsMessage, type SmsProvider, type WhatsAppMessage, type WhatsAppProvider,
} from './types';

/** Development default: logs instead of sending. */
export class ConsoleProvider implements SmsProvider, WhatsAppProvider, EmailProvider {
  readonly name = 'console';
  private readonly log = new Logger('Notifications:console');
  private seq = 0;

  async sendSms(msg: SmsMessage): Promise<SendResult> {
    this.log.log(`SMS → ${msg.to}: ${msg.body}`);
    return { messageId: this.nextId() };
  }

  async sendWhatsApp(msg: WhatsAppMessage): Promise<SendResult> {
    this.log.log(`WhatsApp → ${msg.to}: ${msg.body}`);
    return { messageId: this.nextId() };
  }

  async sendEmail(msg: EmailMessage): Promise<SendResult> {
    this.log.log(`Email → ${msg.to}: ${msg.subject}\n${msg.text}`);
    return { messageId: this.nextId() };
  }

  private nextId() {
    return `console-${Date.now().toString(36)}-${++this.seq}`;
  }
}

/**
 * Twilio Programmable Messaging (SMS and WhatsApp).
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 *   TWILIO_FROM (E.164 sender) or TWILIO_MESSAGING_SERVICE_SID, TWILIO_WHATSAPP_FROM (+1415…)
 */
export class TwilioProvider implements SmsProvider, WhatsAppProvider {
  readonly name = 'twilio';

  async sendSms(msg: SmsMessage): Promise<SendResult> {
    const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
    return this.send(msg.to, msg.body, service ? { MessagingServiceSid: service } : { From: requireEnv('TWILIO_FROM') });
  }

  async sendWhatsApp(msg: WhatsAppMessage): Promise<SendResult> {
    return this.send(`whatsapp:${msg.to}`, msg.body, { From: `whatsapp:${requireEnv('TWILIO_WHATSAPP_FROM')}` });
  }

  private async send(to: string, body: string, from: Record<string, string>): Promise<SendResult> {
    const sid = requireEnv('TWILIO_ACCOUNT_SID');
    const token = requireEnv('TWILIO_AUTH_TOKEN');
    const res = await fetchWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, Body: body, ...from }).toString(),
    });
    if (!res.ok) throw new ProviderError(`Twilio ${res.status}: ${snippet(res.text)}`, retryableStatus(res.status));
    return { messageId: (res.json as { sid?: string } | null)?.sid ?? null };
  }
}

/**
 * SMS Misr (smsmisr.com) — Egyptian SMS gateway.
 *   SMSMISR_USERNAME, SMSMISR_PASSWORD, SMSMISR_SENDER (sender token),
 *   SMSMISR_ENVIRONMENT (1 = live, 2 = test; default 1)
 * Response code 1901 = sent; 1903/1904/1905/1906/1907 are account/content errors.
 */
export class SmsMisrProvider implements SmsProvider {
  readonly name = 'smsmisr';

  async sendSms(msg: SmsMessage): Promise<SendResult> {
    const params = new URLSearchParams({
      environment: process.env.SMSMISR_ENVIRONMENT ?? '1',
      username: requireEnv('SMSMISR_USERNAME'),
      password: requireEnv('SMSMISR_PASSWORD'),
      sender: requireEnv('SMSMISR_SENDER'),
      mobile: digitsOnly(msg.to),
      language: needsUnicode(msg.body) ? '2' : '1',
      message: msg.body,
    });
    const res = await fetchWithTimeout(`https://smsmisr.com/api/SMS/?${params.toString()}`, { method: 'POST' });
    if (!res.ok) throw new ProviderError(`SMS Misr HTTP ${res.status}: ${snippet(res.text)}`, retryableStatus(res.status));
    const body = (res.json ?? {}) as { code?: string | number; SMSID?: string | number };
    const code = String(body.code ?? '');
    if (code !== '1901') {
      // 1908 = invalid date, 1909 = invalid sender, 1910/1911 = invalid mobile/message → not retryable;
      // 1902 = invalid request (transient on their side occasionally) → retry.
      throw new ProviderError(`SMS Misr rejected the message (code ${code || 'unknown'})`, code === '1902');
    }
    return { messageId: body.SMSID != null ? String(body.SMSID) : null };
  }
}

/**
 * Victory Link (vlserv.com) — Egyptian SMS gateway.
 *   VICTORYLINK_USERNAME, VICTORYLINK_PASSWORD, VICTORYLINK_SENDER,
 *   VICTORYLINK_URL (optional override of the SendSMS endpoint)
 * The API answers a bare integer: 0 = success, negative = error.
 */
export class VictoryLinkProvider implements SmsProvider {
  readonly name = 'victorylink';
  static readonly DEFAULT_URL = 'https://smsvas.vlserv.com/VLSMSPlatformResellerAPI/NewSendingAPI/api/SMSSender/SendSMS';

  async sendSms(msg: SmsMessage): Promise<SendResult> {
    const smsId = crypto.randomUUID();
    const res = await fetchWithTimeout(process.env.VICTORYLINK_URL || VictoryLinkProvider.DEFAULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        UserName: requireEnv('VICTORYLINK_USERNAME'),
        Password: requireEnv('VICTORYLINK_PASSWORD'),
        SMSText: msg.body,
        SMSLang: needsUnicode(msg.body) ? 'a' : 'e',
        SMSSender: requireEnv('VICTORYLINK_SENDER'),
        SMSReceiver: egyptLocal(msg.to),
        SMSID: smsId,
      }),
    });
    if (!res.ok) throw new ProviderError(`Victory Link HTTP ${res.status}: ${snippet(res.text)}`, retryableStatus(res.status));
    const code = Number(String(res.text).trim().replace(/"/g, ''));
    if (code !== 0) {
      // -1 user error, -5 out of credit, -10 unknown error (retry), -11 invalid receiver, -12 invalid sender
      throw new ProviderError(`Victory Link rejected the message (code ${Number.isNaN(code) ? snippet(res.text, 60) : code})`, code === -10);
    }
    return { messageId: smsId };
  }
}

/**
 * Meta WhatsApp Cloud API.
 *   WHATSAPP_CLOUD_TOKEN, WHATSAPP_CLOUD_PHONE_ID, WHATSAPP_CLOUD_API_VERSION (default v21.0),
 *   WHATSAPP_CLOUD_TEMPLATE_PREFIX — when set, messages are sent as approved templates named
 *   `<prefix><template>` (required for business-initiated messages outside the 24 h window).
 */
export class WhatsAppCloudProvider implements WhatsAppProvider {
  readonly name = 'whatsapp_cloud';

  async sendWhatsApp(msg: WhatsAppMessage): Promise<SendResult> {
    const version = process.env.WHATSAPP_CLOUD_API_VERSION || 'v21.0';
    const phoneId = requireEnv('WHATSAPP_CLOUD_PHONE_ID');
    const prefix = process.env.WHATSAPP_CLOUD_TEMPLATE_PREFIX;
    const payload =
      prefix && msg.template
        ? {
            messaging_product: 'whatsapp',
            to: digitsOnly(msg.to),
            type: 'template',
            template: {
              name: `${prefix}${msg.template.name}`,
              language: { code: msg.template.locale },
              components: msg.template.params.length
                ? [{ type: 'body', parameters: msg.template.params.map((text) => ({ type: 'text', text })) }]
                : [],
            },
          }
        : { messaging_product: 'whatsapp', to: digitsOnly(msg.to), type: 'text', text: { preview_url: true, body: msg.body } };
    const res = await fetchWithTimeout(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${requireEnv('WHATSAPP_CLOUD_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new ProviderError(`WhatsApp Cloud ${res.status}: ${snippet(res.text)}`, retryableStatus(res.status));
    const id = (res.json as { messages?: Array<{ id?: string }> } | null)?.messages?.[0]?.id;
    return { messageId: id ?? null };
  }
}

/** "GoTurtle <no-reply@goturtle.eg>" → { name, email } */
export function parseFrom(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: from.trim() };
}

/** Resend (resend.com). RESEND_API_KEY, EMAIL_FROM */
export class ResendProvider implements EmailProvider {
  readonly name = 'resend';

  async sendEmail(msg: EmailMessage): Promise<SendResult> {
    const res = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${requireEnv('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: requireEnv('EMAIL_FROM'), to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (!res.ok) throw new ProviderError(`Resend ${res.status}: ${snippet(res.text)}`, retryableStatus(res.status));
    return { messageId: (res.json as { id?: string } | null)?.id ?? null };
  }
}

/** SendGrid v3 Mail Send. SENDGRID_API_KEY, EMAIL_FROM */
export class SendGridProvider implements EmailProvider {
  readonly name = 'sendgrid';

  async sendEmail(msg: EmailMessage): Promise<SendResult> {
    const res = await fetchWithTimeout('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${requireEnv('SENDGRID_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: msg.to }] }],
        from: parseFrom(requireEnv('EMAIL_FROM')),
        subject: msg.subject,
        content: [
          { type: 'text/plain', value: msg.text },
          { type: 'text/html', value: msg.html },
        ],
      }),
    });
    if (!res.ok) throw new ProviderError(`SendGrid ${res.status}: ${snippet(res.text)}`, retryableStatus(res.status));
    return { messageId: res.headers.get('x-message-id') };
  }
}
