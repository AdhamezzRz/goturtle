/** Provider abstraction for outbound messages. Each provider is selected by config.notifications.* */

export interface SendResult {
  /** Provider's message id when it returns one. */
  messageId?: string | null;
}

export interface SmsMessage {
  /** E.164, e.g. +201001234567 */
  to: string;
  body: string;
}

export interface WhatsAppMessage {
  to: string;
  body: string;
  /** Template name + ordered body parameters for providers that require approved templates. */
  template?: { name: string; locale: 'ar' | 'en'; params: string[] };
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SmsProvider {
  readonly name: string;
  sendSms(msg: SmsMessage): Promise<SendResult>;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendWhatsApp(msg: WhatsAppMessage): Promise<SendResult>;
}

export interface EmailProvider {
  readonly name: string;
  sendEmail(msg: EmailMessage): Promise<SendResult>;
}

/**
 * A send failure. `retryable: false` (invalid number, rejected content, bad
 * credentials) marks the notification FAILED right away instead of retrying.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Classifies an HTTP status from a provider: 5xx / 429 are worth retrying, other 4xx are not. */
export const retryableStatus = (status: number) => status >= 500 || status === 429 || status === 408;

/** +201001234567 → 201001234567 */
export const digitsOnly = (e164: string) => e164.replace(/^\+/, '');

/** +201001234567 → 01001234567 */
export const egyptLocal = (e164: string) => (e164.startsWith('+20') ? `0${e164.slice(3)}` : e164);

/** True when the text needs UCS-2 (e.g. Arabic) instead of the GSM-7 alphabet. */
export function needsUnicode(text: string): boolean {
  // GSM 03.38 basic set + extension table.
  return !/^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(text);
}

/** Number of SMS segments a text costs (GSM-7: 160/153, UCS-2: 70/67). */
export function smsSegments(text: string): number {
  const unicode = needsUnicode(text);
  const len = unicode ? [...text].length : [...text].reduce((n, ch) => n + ('^{}\\[~]|€'.includes(ch) ? 2 : 1), 0);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  if (len <= single) return 1;
  return Math.ceil(len / multi);
}
