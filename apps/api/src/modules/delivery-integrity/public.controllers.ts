import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { config } from '../../config';
import { hmacSha256, safeEqual } from '../../common/crypto';
import { Access, CurrentPrincipal, Public, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import { DomainError } from '../../common/errors';
import { actorFromPrincipal, type ActorContext } from '../../common/actor';
import { requireCourierId, type Principal } from '../../common/principal';
import { AttemptsService } from './attempts.service';
import { CustomerActionsService } from './customer-actions.service';
import { InboundService, type InboundInput } from './inbound.service';
import { verifyTwilioSignature } from './call-providers';
import { AttemptFeedbackDto, CallResultDto, CustomerConfirmationDto, IntegrityStateQuery, PinDto, StartCallDto } from './integrity.dto';

const CUSTOMER_LIMIT = { default: { limit: 20, ttl: 60_000 } };

// ---------------------------------------------------------------------------
//  Customer tracking page
// ---------------------------------------------------------------------------

@ApiTags('Tracking')
@Controller({ path: 'track', version: '1' })
export class CustomerIntegrityController {
  constructor(private readonly customers: CustomerActionsService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':trackingNumber/integrity')
  @ApiOperation({ summary: 'Confirmation / attempt verification / pin request state (signed link tokens c, a, p or a customer session unlock actions)' })
  state(@Param('trackingNumber') tn: string, @Query() q: IntegrityStateQuery, @CurrentPrincipal() p?: Principal) {
    return this.customers.state(tn, q, p);
  }

  @Public()
  @ApiBearerAuth()
  @Throttle(CUSTOMER_LIMIT)
  @Post(':trackingNumber/confirmation')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer: confirm / change the day / decline the delivery (signed token or customer session)' })
  confirm(@Param('trackingNumber') tn: string, @Body() dto: CustomerConfirmationDto, @RequestMeta() meta: RequestMetaInfo, @CurrentPrincipal() p?: Principal) {
    return this.customers.confirm(tn, dto, p, meta);
  }

  @Public()
  @ApiBearerAuth()
  @Throttle(CUSTOMER_LIMIT)
  @Post(':trackingNumber/attempt-feedback')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer: confirm or dispute ("I was available") the latest failed attempt' })
  attemptFeedback(@Param('trackingNumber') tn: string, @Body() dto: AttemptFeedbackDto, @CurrentPrincipal() p?: Principal) {
    return this.customers.attemptFeedback(tn, dto, p);
  }

  @Public()
  @ApiBearerAuth()
  @Throttle(CUSTOMER_LIMIT)
  @Post(':trackingNumber/pin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Customer: drop the delivery pin (verifies the address)' })
  pin(@Param('trackingNumber') tn: string, @Body() dto: PinDto, @CurrentPrincipal() p?: Principal) {
    return this.customers.pin(tn, dto, p);
  }
}

// ---------------------------------------------------------------------------
//  Hero calls
// ---------------------------------------------------------------------------

const hero = (p: Principal): ActorContext => ({ ...actorFromPrincipal(p), courierId: requireCourierId(p) });

@ApiTags('Hero tasks')
@ApiBearerAuth()
@Access({ actors: ['courier'] })
@Controller({ path: 'hero/tasks', version: '1' })
export class HeroCallsController {
  constructor(private readonly attempts: AttemptsService) {}

  @Get('orders/:id/integrity')
  @ApiOperation({ summary: 'Fail-sheet rules for this stop: geofence, destination pin, calls made vs required' })
  integrity(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.attempts.heroIntegrity(id, requireCourierId(p));
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('orders/:id/call')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log a call to the recipient and get the number to dial (masked when a proxy provider is configured)' })
  call(@Param('id') id: string, @Body() dto: StartCallDto, @CurrentPrincipal() p: Principal) {
    return this.attempts.startCall(id, hero(p), dto.to ?? 'PRIMARY');
  }

  @Post('calls/:id/result')
  @HttpCode(200)
  @ApiOperation({ summary: 'Report how the call went (answered / no answer / busy / failed)' })
  result(@Param('id') id: string, @Body() dto: CallResultDto, @CurrentPrincipal() p: Principal) {
    return this.attempts.reportCall(id, requireCourierId(p), dto);
  }
}

// ---------------------------------------------------------------------------
//  Inbound webhooks (WhatsApp Cloud API, SMS gateways, call status)
// ---------------------------------------------------------------------------

type WaMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
};

/** Extracts customer messages from a Meta WhatsApp Cloud API webhook body. */
export function parseWhatsAppWebhook(body: unknown): InboundInput[] {
  const out: InboundInput[] = [];
  const entries = (body as { entry?: Array<{ changes?: Array<{ value?: { messages?: WaMessage[] } }> }> })?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        if (!m.from) continue;
        const base = { channel: 'WHATSAPP' as const, from: m.from, providerMessageId: m.id ?? null, payload: { type: m.type ?? null } };
        if (m.type === 'location' && m.location && Number.isFinite(Number(m.location.latitude)) && Number.isFinite(Number(m.location.longitude))) {
          out.push({ ...base, text: m.location.name ?? m.location.address ?? null, location: { lat: Number(m.location.latitude), lng: Number(m.location.longitude) } });
        } else if (m.type === 'button' && m.button) {
          out.push({ ...base, text: m.button.payload || m.button.text || null });
        } else if (m.type === 'interactive' && m.interactive) {
          const r = m.interactive.button_reply ?? m.interactive.list_reply;
          out.push({ ...base, text: r?.id || r?.title || null });
        } else if (m.text?.body) {
          out.push({ ...base, text: m.text.body });
        } else {
          out.push({ ...base, text: null });
        }
      }
    }
  }
  return out;
}

const pick = (body: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
};

@ApiTags('Integrations')
@Controller({ path: 'integrations', version: '1' })
export class InboundController {
  constructor(
    private readonly inbound: InboundService,
    private readonly attempts: AttemptsService,
  ) {}

  /** Meta webhook verification handshake. */
  @Public()
  @SkipThrottle()
  @Get('inbound/whatsapp')
  verify(@Query() q: Record<string, string>, @Res() res: Response) {
    const token = process.env.WHATSAPP_VERIFY_TOKEN;
    if (token && q['hub.mode'] === 'subscribe' && typeof q['hub.verify_token'] === 'string' && safeEqual(q['hub.verify_token'], token)) {
      res.status(200).type('text/plain').send(String(q['hub.challenge'] ?? ''));
      return;
    }
    res.status(403).json({ code: 'INVALID_VERIFY_TOKEN', message: 'Verification failed' });
  }

  @Public()
  @SkipThrottle()
  @Post('inbound/whatsapp')
  @HttpCode(200)
  @ApiOperation({ summary: 'WhatsApp Cloud API webhook (X-Hub-Signature-256 = HMAC-SHA256 of the raw body with WHATSAPP_APP_SECRET)' })
  async whatsapp(@Req() req: Request & { rawBody?: Buffer }, @Body() body: Record<string, unknown>) {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) throw new DomainError('WEBHOOK_NOT_CONFIGURED', 'WHATSAPP_APP_SECRET is not configured', HttpStatus.SERVICE_UNAVAILABLE);
    const header = req.headers['x-hub-signature-256'];
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body ?? {}));
    const expected = `sha256=${hmacSha256(secret, raw.toString('utf8'))}`;
    if (typeof header !== 'string' || !safeEqual(header, expected)) throw new DomainError('INVALID_SIGNATURE', 'Invalid webhook signature', HttpStatus.UNAUTHORIZED);
    const messages = parseWhatsAppWebhook(body);
    const results = [];
    for (const m of messages) results.push(await this.inbound.handle(m));
    return { received: messages.length, results };
  }

  /** Generic two-way SMS gateway webhook (form or JSON: from, body, id). */
  @Public()
  @SkipThrottle()
  @Post('inbound/sms')
  @HttpCode(200)
  async sms(@Query('key') key: string | undefined, @Body() body: Record<string, unknown>) {
    const secret = process.env.SMS_INBOUND_SECRET;
    if (!secret) throw new DomainError('WEBHOOK_NOT_CONFIGURED', 'SMS_INBOUND_SECRET is not configured', HttpStatus.SERVICE_UNAVAILABLE);
    if (!key || !safeEqual(key, secret)) throw new DomainError('INVALID_SIGNATURE', 'Invalid webhook key', HttpStatus.UNAUTHORIZED);
    const b = (body ?? {}) as Record<string, unknown>;
    const from = pick(b, ['from', 'From', 'msisdn', 'sender', 'phone', 'mobile']);
    const text = pick(b, ['body', 'Body', 'text', 'message', 'content', 'msg']);
    if (!from) throw new DomainError('INVALID_PAYLOAD', 'Missing sender phone (from)', HttpStatus.BAD_REQUEST);
    const result = await this.inbound.handle({ channel: 'SMS', from, text, providerMessageId: pick(b, ['id', 'MessageSid', 'messageId', 'message_id', 'smsId']), payload: { gateway: 'generic' } });
    return { received: 1, result };
  }

  /** Twilio Proxy interaction / call status callback (X-Twilio-Signature verified with TWILIO_AUTH_TOKEN). */
  @Public()
  @SkipThrottle()
  @Post('calls/twilio/status')
  @HttpCode(200)
  twilioStatus(@Req() req: Request, @Body() body: Record<string, unknown>) {
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!token) throw new DomainError('WEBHOOK_NOT_CONFIGURED', 'TWILIO_AUTH_TOKEN is not configured', HttpStatus.SERVICE_UNAVAILABLE);
    const params = Object.fromEntries(Object.entries(body ?? {}).map(([k, v]) => [k, String(v ?? '')]));
    const url = process.env.TWILIO_STATUS_CALLBACK_URL || `${config.appUrl}${req.originalUrl}`;
    const header = req.headers['x-twilio-signature'];
    if (!verifyTwilioSignature(token, url, params, typeof header === 'string' ? header : undefined)) {
      throw new DomainError('INVALID_SIGNATURE', 'Invalid Twilio signature', HttpStatus.UNAUTHORIZED);
    }
    const sid = params.InteractionSessionSid || params.SessionSid || params.CallSid || '';
    const status = params.OutboundResourceStatus || params.InteractionOutboundResourceStatus || params.CallStatus || params.InboundResourceStatus;
    const duration = params.CallDuration ? Number(params.CallDuration) : null;
    return this.attempts.providerStatus(sid, status, Number.isFinite(duration) ? duration : null);
  }
}
