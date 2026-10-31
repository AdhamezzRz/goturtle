import type { FailureReason, Locale } from '@goturtle/shared';

/**
 * Bilingual message templates (Arabic is the default for customers).
 *
 * `body` is what goes out by SMS / WhatsApp / in-app, so it is kept short:
 * Arabic SMS are UCS-2 (70 chars for one segment, 67 per segment after that),
 * customer order updates target ≤ 2 segments and OTP codes 1–2 segments.
 * E-mails reuse title + body wrapped in a simple HTML layout, with optional
 * longer `email` text.
 *
 * Variables use {{name}}; missing variables render as an empty string.
 * Customer-facing templates only receive whitelisted order fields (tracking
 * number, brand, hero first name, ETA, reason label, links) — never internal notes.
 */
export const TEMPLATE_NAMES = [
  'order_created', 'out_for_delivery', 'delivered', 'failed_attempt', 'returned',
  'otp_tracking', 'otp_password_reset', 'otp_delivery', 'otp_login',
  'user_invited', 'temp_password', 'settlement_paid',
  'ticket_created', 'ticket_reply', 'ticket_assigned', 'ticket_sla_breached',
  'brand_registered', 'brand_approved', 'webhook_disabled', 'payment_link', 'integration_error',
] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export type TemplateVars = Record<string, string | number | null | undefined>;

interface LocalizedTemplate {
  title: string;
  body: string;
  /** Optional longer text used for e-mail instead of body. */
  email?: string;
}

interface TemplateDef {
  ar: LocalizedTemplate;
  en: LocalizedTemplate;
  /** Variable order for providers that need pre-approved templates (WhatsApp Cloud). */
  params: string[];
}

export const TEMPLATES: Record<TemplateName, TemplateDef> = {
  order_created: {
    ar: { title: 'تم تسجيل شحنتك', body: '{{brand}}: شحنتك {{tn}} اتسجلت مع {{company}}. تتبعها: {{link}}' },
    en: { title: 'Shipment booked', body: '{{brand}}: your shipment {{tn}} is booked with {{company}}. Track: {{link}}' },
    params: ['brand', 'tn', 'company', 'link'],
  },
  out_for_delivery: {
    ar: { title: 'شحنتك خرجت للتوصيل', body: 'شحنتك من {{brand}} مع المندوب {{hero}} وهتوصل {{eta}}.{{otpNote}} {{link}}' },
    en: { title: 'Out for delivery', body: 'Your {{brand}} parcel is out with {{hero}}, arriving {{eta}}.{{otpNote}} {{link}}' },
    params: ['brand', 'hero', 'eta', 'otpNote', 'link'],
  },
  delivered: {
    ar: { title: 'تم التوصيل', body: 'تم تسليم شحنتك {{tn}} من {{brand}}. قيّم تجربتك: {{link}}' },
    en: { title: 'Delivered', body: 'Your {{brand}} parcel {{tn}} was delivered. Rate us: {{link}}' },
    params: ['tn', 'brand', 'link'],
  },
  failed_attempt: {
    ar: { title: 'تعذر التوصيل', body: 'تعذر توصيل شحنتك {{tn}} ({{reason}}). حدد موعد جديد: {{link}}' },
    en: { title: 'Delivery attempt failed', body: 'We could not deliver {{tn}} ({{reason}}). Pick a new time: {{link}}' },
    params: ['tn', 'reason', 'link'],
  },
  returned: {
    ar: { title: 'تم إرجاع الشحنة', body: 'شحنتك {{tn}} رجعت لـ {{brand}}. للاستفسار تواصل مع التاجر.' },
    en: { title: 'Shipment returned', body: 'Your parcel {{tn}} was returned to {{brand}}. Please contact the seller.' },
    params: ['tn', 'brand'],
  },
  otp_tracking: {
    ar: { title: 'كود الدخول', body: 'كود {{company}}: {{code}} صالح {{minutes}} دقائق. لا تشاركه مع أحد.' },
    en: { title: 'Your login code', body: '{{company}} code: {{code}}. Valid {{minutes}} min. Do not share it.' },
    params: ['company', 'code', 'minutes'],
  },
  otp_login: {
    ar: { title: 'كود الدخول', body: 'كود {{company}}: {{code}} صالح {{minutes}} دقائق. لا تشاركه مع أحد.' },
    en: { title: 'Your login code', body: '{{company}} code: {{code}}. Valid {{minutes}} min. Do not share it.' },
    params: ['company', 'code', 'minutes'],
  },
  otp_password_reset: {
    ar: { title: 'إعادة تعيين كلمة المرور', body: 'كود إعادة تعيين كلمة مرور {{company}}: {{code}}. لا تشاركه.' },
    en: { title: 'Password reset code', body: '{{company}} password reset code: {{code}}. Do not share it.' },
    params: ['company', 'code'],
  },
  otp_delivery: {
    ar: { title: 'كود استلام الشحنة', body: 'كود استلام شحنتك {{tn}}: {{code}}. اديه للمندوب بعد ما تستلم بس.' },
    en: { title: 'Delivery code', body: 'Delivery code for {{tn}}: {{code}}. Give it to the hero only on receipt.' },
    params: ['tn', 'code'],
  },
  user_invited: {
    ar: {
      title: 'تم إنشاء حسابك',
      body: 'أهلاً {{name}}، حسابك على {{company}} جاهز. كلمة المرور المؤقتة: {{password}} ادخل من {{link}}',
      email: 'أهلاً {{name}}،\n\nتم إنشاء حسابك على {{company}}.\nرقم الدخول: {{phone}}\nكلمة المرور المؤقتة: {{password}}\n\nادخل من {{link}} وغيّر كلمة المرور فوراً.',
    },
    en: {
      title: 'Your account is ready',
      body: 'Hi {{name}}, your {{company}} account is ready. Temp password: {{password}} Sign in: {{link}}',
      email: 'Hi {{name}},\n\nAn account was created for you on {{company}}.\nSign-in phone: {{phone}}\nTemporary password: {{password}}\n\nSign in at {{link}} and change your password right away.',
    },
    params: ['name', 'company', 'password', 'link'],
  },
  temp_password: {
    ar: { title: 'كلمة مرور جديدة', body: '{{company}}: تم إعادة تعيين كلمة المرور. كلمة المرور المؤقتة: {{password}} ادخل من {{link}}' },
    en: { title: 'Password reset', body: '{{company}}: your password was reset. Temp password: {{password}} Sign in: {{link}}' },
    params: ['company', 'password', 'link'],
  },
  settlement_paid: {
    ar: {
      title: 'تم تحويل التسوية {{code}}',
      body: 'تم تحويل {{amount}} لحسابك عن الفترة {{period}}.',
      email: 'تم دفع التسوية {{code}} بقيمة {{amount}} عن الفترة {{period}}.\nمرجع التحويل: {{reference}}\n\nالتفاصيل في بوابة التاجر: {{link}}',
    },
    en: {
      title: 'Settlement {{code}} paid',
      body: '{{amount}} was transferred to you for {{period}}.',
      email: 'Settlement {{code}} for {{amount}} ({{period}}) has been paid.\nPayment reference: {{reference}}\n\nSee the details in your brand portal: {{link}}',
    },
    params: ['code', 'amount', 'period'],
  },
  ticket_created: {
    ar: { title: 'تذكرة جديدة {{code}}', body: '{{subject}} — أولوية {{priority}}' },
    en: { title: 'New ticket {{code}}', body: '{{subject}} — {{priority}} priority' },
    params: ['code', 'subject', 'priority'],
  },
  ticket_reply: {
    ar: { title: 'رد جديد على التذكرة {{code}}', body: 'في رد جديد على تذكرتك {{code}}: {{link}}' },
    en: { title: 'New reply on {{code}}', body: 'There is a new reply on your ticket {{code}}: {{link}}' },
    params: ['code', 'link'],
  },
  ticket_assigned: {
    ar: { title: 'تم تعيين التذكرة {{code}} لك', body: '{{subject}} — أولوية {{priority}}' },
    en: { title: 'Ticket {{code}} assigned to you', body: '{{subject}} — {{priority}} priority' },
    params: ['code', 'subject', 'priority'],
  },
  ticket_sla_breached: {
    ar: { title: 'تجاوز وقت الاستجابة: {{code}}', body: 'التذكرة {{code}} ({{subject}}) تجاوزت وقت الـ SLA. الأولوية الآن {{priority}}.' },
    en: { title: 'SLA breached: {{code}}', body: 'Ticket {{code}} ({{subject}}) breached its SLA. Priority is now {{priority}}.' },
    params: ['code', 'subject', 'priority'],
  },
  brand_registered: {
    ar: { title: 'تاجر جديد في انتظار الموافقة', body: '{{brand}} ({{code}}) سجّل وفي انتظار المراجعة.' },
    en: { title: 'New brand awaiting approval', body: '{{brand}} ({{code}}) signed up and is waiting for review.' },
    params: ['brand', 'code'],
  },
  brand_approved: {
    ar: { title: 'تم تفعيل حسابك', body: 'تم تفعيل حساب {{brand}} على {{company}}. تقدر تبدأ تسجل شحناتك دلوقتي: {{link}}' },
    en: { title: 'Your account is active', body: '{{brand}} is now active on {{company}}. You can start booking shipments: {{link}}' },
    params: ['brand', 'company', 'link'],
  },
  webhook_disabled: {
    ar: { title: 'تم إيقاف Webhook', body: 'تم إيقاف {{url}} بعد {{failures}} محاولة فاشلة متتالية. صلّح الرابط وفعّله تاني.' },
    en: { title: 'Webhook disabled', body: '{{url}} was disabled after {{failures}} consecutive failures. Fix it and re-enable it.' },
    params: ['url', 'failures'],
  },
  payment_link: {
    ar: { title: 'ادفع أونلاين', body: 'تقدر تدفع {{amount}} لشحنتك {{tn}} من {{brand}} أونلاين: {{link}}' },
    en: { title: 'Pay online', body: 'Pay {{amount}} for your {{brand}} parcel {{tn}} online: {{link}}' },
    params: ['amount', 'tn', 'brand', 'link'],
  },
  integration_error: {
    ar: { title: 'مشكلة في ربط {{provider}}', body: 'طلب {{reference}} من {{shop}} لم يتم إنشاؤه: {{error}}' },
    en: { title: '{{provider}} sync problem', body: 'Order {{reference}} from {{shop}} was not created: {{error}}' },
    params: ['provider', 'reference', 'shop', 'error'],
  },
};

/** Small locale-specific fragments assembled by listeners. */
export const SNIPPETS = {
  otpNote: { ar: ' هيوصلك كود الاستلام في رسالة.', en: ' You will get a delivery code by SMS.' },
  today: { ar: 'النهارده', en: 'today' },
  between: { ar: 'بين {{from}} و {{to}}', en: 'between {{from}} and {{to}}' },
} as const;

export const FAILURE_REASON_LABELS: Record<FailureReason, { ar: string; en: string }> = {
  CUSTOMER_UNREACHABLE: { ar: 'تعذر الوصول إليك', en: 'we could not reach you' },
  CUSTOMER_REFUSED: { ar: 'تم رفض الاستلام', en: 'delivery was refused' },
  CUSTOMER_RESCHEDULED: { ar: 'طلبت تأجيل الموعد', en: 'you asked to reschedule' },
  WRONG_ADDRESS: { ar: 'العنوان غير صحيح', en: 'wrong address' },
  INCOMPLETE_ADDRESS: { ar: 'العنوان غير مكتمل', en: 'incomplete address' },
  NO_CASH: { ar: 'المبلغ لم يكن متاحاً', en: 'cash was not ready' },
  CUSTOMER_NOT_PRESENT: { ar: 'لم يكن هناك أحد للاستلام', en: 'nobody was available' },
  OUT_OF_ZONE: { ar: 'العنوان خارج منطقة التغطية', en: 'address outside our area' },
  PACKAGE_DAMAGED: { ar: 'الشحنة بها تلف', en: 'the parcel was damaged' },
  SECURITY_ACCESS: { ar: 'تعذر الدخول للمبنى', en: 'no building access' },
  OTHER: { ar: 'سبب آخر', en: 'other reason' },
};

export const PRIORITY_LABELS = {
  LOW: { ar: 'منخفضة', en: 'low' },
  MEDIUM: { ar: 'متوسطة', en: 'medium' },
  HIGH: { ar: 'عالية', en: 'high' },
  URGENT: { ar: 'عاجلة', en: 'urgent' },
} as const;

export interface RenderedMessage {
  title: string;
  body: string;
  /** Plain text e-mail body. */
  text: string;
  html: string;
  /** Ordered values for template-based providers. */
  params: string[];
}

export const interpolate = (text: string, vars: TemplateVars) =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? '' : String(v);
  });

/** Renders a template; unknown locales fall back to Arabic. */
export function renderTemplate(name: TemplateName, locale: Locale | string | null | undefined, vars: TemplateVars): RenderedMessage {
  const def = TEMPLATES[name];
  if (!def) throw new Error(`Unknown notification template ${name}`);
  const loc: Locale = locale === 'en' ? 'en' : 'ar';
  const t = def[loc];
  const clean = (s: string) => s.replace(/[ \t]{2,}/g, ' ').replace(/ ([.,،])/g, '$1').trim();
  const title = clean(interpolate(t.title, vars));
  const body = clean(interpolate(t.body, vars));
  const text = t.email ? interpolate(t.email, vars).trim() : body;
  return { title, body, text, html: emailHtml(title, text, loc), params: def.params.map((p) => String(vars[p] ?? '').trim() || '-') };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function emailHtml(title: string, text: string, locale: Locale): string {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const paragraphs = escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1E8E5A">$1</a>')}</p>`)
    .join('');
  return [
    `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;background:#f4f6f5;font-family:Tahoma,Arial,sans-serif">`,
    `<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;padding:28px;color:#1d2b24;font-size:15px;line-height:1.6" dir="${dir}">`,
    `<h2 style="margin:0 0 16px;font-size:20px;color:#1E8E5A">${escapeHtml(title)}</h2>${paragraphs}`,
    `</div></body></html>`,
  ].join('');
}
