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
  // delivery integrity & address intelligence
  'confirm_delivery', 'confirmation_ack', 'reschedule_ack', 'decline_ack', 'attempt_verify', 'attempt_ack', 'dispute_ack',
  'location_request', 'location_ack', 'inbound_help', 'prepay_required', 'attempt_disputed',
  // v1.1 money programs & quality
  'collection_rejected', 'advance_requested', 'advance_update', 'claim_filed', 'claim_update', 'weight_adjusted', 'weight_dispute_resolved',
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
  // ---------------------------------------------------------------- delivery integrity & address intelligence
  confirm_delivery: {
    ar: { title: 'أكد استلام شحنتك', body: '{{brand}}: شحنتك {{tn}} ({{amount}}) جاهزة. رد 1 للتأكيد، 2 لتغيير اليوم، 3 للإلغاء. أو: {{link}}' },
    en: { title: 'Confirm your delivery', body: '{{brand}}: parcel {{tn}} ({{amount}}) is ready. Reply 1 confirm, 2 change day, 3 cancel. Or: {{link}}' },
    params: ['brand', 'tn', 'amount', 'link'],
  },
  confirmation_ack: {
    ar: { title: 'تم التأكيد', body: 'شكراً! تم تأكيد شحنتك {{tn}} وهنبلغك لما تخرج للتوصيل.' },
    en: { title: 'Confirmed', body: 'Thanks! Parcel {{tn}} is confirmed. We will tell you when it is out for delivery.' },
    params: ['tn'],
  },
  reschedule_ack: {
    ar: { title: 'تم تغيير الموعد', body: 'تمام، شحنتك {{tn}} هتوصل يوم {{date}}. لتغيير اليوم: {{link}}' },
    en: { title: 'New delivery day', body: 'Done, parcel {{tn}} will arrive on {{date}}. To change the day: {{link}}' },
    params: ['tn', 'date', 'link'],
  },
  decline_ack: {
    ar: { title: 'تم إلغاء الاستلام', body: 'تم تسجيل رفضك لشحنتك {{tn}} وهنبلغ {{brand}}.' },
    en: { title: 'Delivery cancelled', body: 'We recorded that you do not want parcel {{tn}}. We will let {{brand}} know.' },
    params: ['tn', 'brand'],
  },
  attempt_verify: {
    ar: { title: 'محاولة توصيل', body: 'المندوب {{hero}} حاول يوصل شحنتك {{tn}} الساعة {{time}} ({{reason}}). رد 1 لو صحيح، 2 لو مش صحيح: {{link}}' },
    en: { title: 'Delivery attempt', body: 'Hero {{hero}} tried to deliver {{tn}} at {{time}} ({{reason}}). Reply 1 if correct, 2 if not: {{link}}' },
    params: ['hero', 'tn', 'time', 'reason', 'link'],
  },
  attempt_ack: {
    ar: { title: 'شكراً لردك', body: 'شكراً، تم تسجيل ردك على محاولة توصيل {{tn}}. حدد موعد جديد: {{link}}' },
    en: { title: 'Thanks for your reply', body: 'Thanks, we noted your reply about {{tn}}. Pick a new time: {{link}}' },
    params: ['tn', 'link'],
  },
  dispute_ack: {
    ar: { title: 'تم استلام شكوتك', body: 'آسفين! فتحنا شكوى {{code}} عن محاولة توصيل {{tn}} وهنراجعها بسرعة ونوصلها لك.' },
    en: { title: 'We are on it', body: 'Sorry! Complaint {{code}} about the attempt on {{tn}} is open. We will review it and re-deliver.' },
    params: ['code', 'tn'],
  },
  location_request: {
    ar: { title: 'ابعت موقعك', body: 'عشان شحنتك {{tn}} توصل أسرع ابعت لوكيشن واتساب أو حدد مكانك: {{link}}' },
    en: { title: 'Share your location', body: 'Help us deliver {{tn}} faster: send a WhatsApp location or drop your pin: {{link}}' },
    params: ['tn', 'link'],
  },
  location_ack: {
    ar: { title: 'تم حفظ موقعك', body: 'شكراً! حفظنا موقعك لشحنة {{tn}}.' },
    en: { title: 'Location saved', body: 'Thanks! We saved your location for {{tn}}.' },
    params: ['tn'],
  },
  inbound_help: {
    ar: { title: 'محتاجين توضيح', body: 'مفهمناش ردك. لشحنة {{tn}} رد برقم من الاختيارات أو افتح: {{link}}' },
    en: { title: 'Please choose an option', body: 'We did not understand your reply about {{tn}}. Reply with an option number or open: {{link}}' },
    params: ['tn', 'link'],
  },
  prepay_required: {
    ar: { title: 'الشحنة {{tn}} محتاجة دفع مسبق', body: 'المستلم {{phone}} عالي المخاطرة في الدفع عند الاستلام. ابعت له لينك دفع أو حوّل الطلب لمدفوع مسبقاً عشان نشحنه.' },
    en: { title: 'Prepayment needed for {{tn}}', body: 'Recipient {{phone}} is high risk for cash on delivery. Send a payment link or switch the order to prepaid to ship it.' },
    params: ['tn', 'phone'],
  },
  attempt_disputed: {
    ar: { title: 'العميل اعترض على محاولة توصيل', body: '{{tn}}: العميل بيقول إن محاولة المندوب {{hero}} غير صحيحة. التذكرة {{code}}.' },
    en: { title: 'Customer disputed an attempt', body: '{{tn}}: the customer says the attempt by {{hero}} did not happen. Ticket {{code}}.' },
    params: ['tn', 'hero', 'code'],
  },
  // ------------------------------------------------------------- v1.1 money programs & quality
  collection_rejected: {
    ar: { title: 'تحويل غير مستلم {{tn}}', body: 'لم يصل تحويل {{amount}} لشحنة {{tn}}. المبلغ اتضاف لعهدتك النقدية: {{note}}' },
    en: { title: 'Transfer not received {{tn}}', body: 'The {{amount}} transfer for {{tn}} never arrived. It was added to your cash custody: {{note}}' },
    params: ['tn', 'amount', 'note'],
  },
  advance_requested: {
    ar: { title: 'طلب {{type}} {{code}}', body: '{{brand}} طلب {{amount}} ({{type}}). راجع الطلب.' },
    en: { title: '{{type}} request {{code}}', body: '{{brand}} requested {{amount}} ({{type}}). Please review it.' },
    params: ['type', 'code', 'brand', 'amount'],
  },
  advance_update: {
    ar: { title: 'طلبك {{code}}: {{status}}', body: '{{type}} بقيمة {{amount}} — {{status}}. {{note}}', email: 'طلبك {{code}} ({{type}}) بقيمة {{amount}} أصبح: {{status}}.\n{{note}}\n\nالتفاصيل: {{link}}' },
    en: { title: 'Your request {{code}}: {{status}}', body: '{{type}} of {{amount}} — {{status}}. {{note}}', email: 'Your request {{code}} ({{type}}) for {{amount}} is now {{status}}.\n{{note}}\n\nDetails: {{link}}' },
    params: ['code', 'type', 'amount', 'status'],
  },
  claim_filed: {
    ar: { title: 'مطالبة جديدة {{code}}', body: '{{brand}}: {{type}} على {{tn}} بقيمة {{amount}}.' },
    en: { title: 'New claim {{code}}', body: '{{brand}}: {{type}} on {{tn}} for {{amount}}.' },
    params: ['code', 'brand', 'type', 'tn', 'amount'],
  },
  claim_update: {
    ar: { title: 'المطالبة {{code}}: {{status}}', body: 'مطالبتك {{code}} على {{tn}} أصبحت {{status}}. {{note}}', email: 'مطالبتك {{code}} على الشحنة {{tn}} أصبحت: {{status}}.\n{{note}}\n\nالتفاصيل: {{link}}' },
    en: { title: 'Claim {{code}}: {{status}}', body: 'Your claim {{code}} on {{tn}} is now {{status}}. {{note}}', email: 'Your claim {{code}} on {{tn}} is now {{status}}.\n{{note}}\n\nDetails: {{link}}' },
    params: ['code', 'tn', 'status', 'note'],
  },
  weight_adjusted: {
    ar: { title: 'تعديل وزن {{tn}}', body: 'الشحنة {{tn}} اتوزنت {{billable}} بدل {{declared}}. فرق الرسوم {{amount}}. تقدر تعترض خلال {{hours}} ساعة.' },
    en: { title: 'Weight adjusted {{tn}}', body: '{{tn}} weighed {{billable}} (declared {{declared}}). Extra fee {{amount}}. You can dispute within {{hours}} h.' },
    params: ['tn', 'billable', 'declared', 'amount', 'hours'],
  },
  weight_dispute_resolved: {
    ar: { title: 'نتيجة اعتراض الوزن {{tn}}', body: 'اعتراضك على وزن {{tn}}: {{decision}}. {{note}}' },
    en: { title: 'Weight dispute {{tn}} resolved', body: 'Your weight dispute on {{tn}}: {{decision}}. {{note}}' },
    params: ['tn', 'decision', 'note'],
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
