/* eslint-disable no-console */
import type { INestApplicationContext } from '@nestjs/common';
import { and, asc, count, eq, inArray, like } from 'drizzle-orm';
import type { TicketCategory, TicketPriority, TicketStatus } from '@goturtle/shared';
import { DB } from '../../core/database.module';
import { SequenceService } from '../../core/sequence.service';
import type { Db } from '../client';
import { apiKeys, brands, integrationConnections, notifications, orders, ticketMessages, tickets, users, webhookEndpoints } from '../schema';
import { encryptJson, randomToken, sha256 } from '../../common/crypto';
import { SettingsService } from '../../modules/settings/settings.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { UsersService } from '../../modules/users/users.service';
import { newWebhookSecret } from '../../modules/webhooks/signature';
import { withDefaultSettings } from '../../modules/integrations/connectors';
import { slaDue } from '../../modules/tickets/tickets.service';
import { DEMO_PASSWORD } from '../seed';

interface DemoTicket {
  brand: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  openedBy: 'BRAND' | 'CUSTOMER' | 'STAFF';
  ageHours: number;
  thread: Array<{ by: 'BRAND' | 'CUSTOMER' | 'STAFF' | 'SYSTEM'; body: string; internal?: boolean }>;
}

const TICKETS: DemoTicket[] = [
  {
    brand: 'NILE', subject: 'Order is two days late', category: 'DELAY', priority: 'HIGH', status: 'OPEN', openedBy: 'BRAND', ageHours: 3,
    thread: [{ by: 'BRAND', body: 'Our customer is asking where the parcel is — it was promised yesterday.' }],
  },
  {
    brand: 'CGAD', subject: 'COD amount collected is wrong', category: 'COD_ISSUE', priority: 'URGENT', status: 'IN_PROGRESS', openedBy: 'BRAND', ageHours: 5,
    thread: [
      { by: 'BRAND', body: 'The statement shows 1,250 EGP collected but the invoice was 1,520 EGP.' },
      { by: 'STAFF', body: 'Thanks — we are checking the hero handover for this order now.' },
      { by: 'STAFF', body: 'Hero declared 1,250 at the hub; finance to review the handover photo.', internal: true },
    ],
  },
  {
    brand: 'BLOOM', subject: 'Customer wants to change the address', category: 'ADDRESS_CHANGE', priority: 'MEDIUM', status: 'WAITING_ON_CUSTOMER', openedBy: 'CUSTOMER', ageHours: 20,
    thread: [
      { by: 'CUSTOMER', body: 'ممكن توصلوا الطلب على عنوان الشغل في المعادي بدل البيت؟' },
      { by: 'STAFF', body: 'أكيد، ابعتلنا العنوان بالتفصيل ورقم الدور والشقة.' },
    ],
  },
  {
    brand: 'NILE', subject: 'Hero was very polite — thank you', category: 'COMPLAINT', priority: 'LOW', status: 'RESOLVED', openedBy: 'CUSTOMER', ageHours: 50,
    thread: [
      { by: 'CUSTOMER', body: 'Just wanted to say Ahmed was great.' },
      { by: 'STAFF', body: 'Thank you! We shared your message with the team.' },
    ],
  },
  {
    brand: 'CGAD', subject: 'Parcel arrived damaged', category: 'DAMAGED', priority: 'HIGH', status: 'CLOSED', openedBy: 'BRAND', ageHours: 120,
    thread: [
      { by: 'BRAND', body: 'The phone box was crushed on arrival, customer refused it.' },
      { by: 'STAFF', body: 'Claim approved: the shipping fee is waived and the item value credited on the next settlement.' },
      { by: 'STAFF', body: 'Root cause: van loading at HUB-NSR. Briefed the hub team.', internal: true },
    ],
  },
  {
    brand: 'BLOOM', subject: 'How do I connect my Shopify store?', category: 'INQUIRY', priority: 'MEDIUM', status: 'OPEN', openedBy: 'STAFF', ageHours: 30,
    thread: [{ by: 'STAFF', body: 'Logged from a phone call: brand wants help with the Shopify integration setup.' }],
  },
];

/**
 * Demo data for the platform modules: default settings, an API key, a
 * webhook endpoint, a paused Shopify connection, support tickets, in-app
 * notifications and one invited staff user. Idempotent; works without orders.
 */
export async function seedPlatformDemo(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  const settings = app.get(SettingsService);
  const notify = app.get(NotificationsService);
  const usersService = app.get(UsersService);
  const sequences = app.get(SequenceService);
  const summary: string[] = [];

  const settingRows = await settings.ensureDefaults();
  if (settingRows) summary.push(`${settingRows} settings`);

  const brandRows = await db.select().from(brands).where(inArray(brands.code, ['NILE', 'CGAD', 'BLOOM']));
  const byCode = new Map(brandRows.map((b) => [b.code, b]));
  const nile = byCode.get('NILE');
  const owners = await db
    .select({ id: users.id, brandId: users.brandId })
    .from(users)
    .where(and(eq(users.role, 'BRAND_OWNER'), inArray(users.brandId, brandRows.map((b) => b.id).length ? brandRows.map((b) => b.id) : ['-'])));
  const ownerOf = new Map(owners.map((o) => [o.brandId!, o.id]));

  if (nile) {
    const [{ n: keyCount }] = await db.select({ n: count() }).from(apiKeys).where(eq(apiKeys.brandId, nile.id));
    if (!Number(keyCount)) {
      const raw = `gt_live_${randomToken(32)}`;
      await db.insert(apiKeys).values({ brandId: nile.id, name: 'Demo ERP sync', prefix: raw.slice(0, 14), keyHash: sha256(raw), scopes: ['orders.read', 'orders.create'], createdById: ownerOf.get(nile.id) ?? null });
      summary.push('1 API key');
    }
    const [{ n: hookCount }] = await db.select({ n: count() }).from(webhookEndpoints).where(eq(webhookEndpoints.brandId, nile.id));
    if (!Number(hookCount)) {
      await db.insert(webhookEndpoints).values({
        brandId: nile.id, url: 'https://example.com/webhooks/goturtle', secret: newWebhookSecret(), events: ['order.delivered', 'order.failed_attempt', 'order.returned'],
        isActive: false, description: 'Demo endpoint (inactive)',
      });
      summary.push('1 webhook endpoint');
    }
    const [{ n: connCount }] = await db.select({ n: count() }).from(integrationConnections).where(eq(integrationConnections.brandId, nile.id));
    if (!Number(connCount)) {
      await db.insert(integrationConnections).values({
        brandId: nile.id, provider: 'SHOPIFY', shopDomain: 'nile-threads.myshopify.com', credentials: encryptJson({ accessToken: 'shpat_demo_not_a_real_token' }),
        settings: withDefaultSettings(null) as unknown as Record<string, unknown>, inboundSecret: `gtin_${randomToken(24)}`, status: 'PAUSED',
        lastError: 'Paused: demo connection — add a real Admin API token to activate.',
      });
      summary.push('1 Shopify connection (paused)');
    }
  }

  // Support tickets
  const [{ n: ticketCount }] = await db.select({ n: count() }).from(tickets).where(like(tickets.code, 'TK-%'));
  if (!Number(ticketCount) && brandRows.length) {
    const support = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, 'SUPPORT')).orderBy(asc(users.createdAt)).limit(1);
    const agent = support[0] ?? null;
    let created = 0;
    for (const t of TICKETS) {
      const brand = byCode.get(t.brand);
      if (!brand) continue;
      const [order] = await db
        .select({ id: orders.id, customerId: orders.customerId, recipientName: orders.recipientName, recipientPhone: orders.recipientPhone })
        .from(orders)
        .where(eq(orders.brandId, brand.id))
        .orderBy(asc(orders.createdAt))
        .limit(1)
        .offset(created);
      const openedAt = new Date(Date.now() - t.ageHours * 3_600_000);
      const ownerId = ownerOf.get(brand.id) ?? null;
      const openerId = t.openedBy === 'BRAND' ? ownerId : t.openedBy === 'STAFF' ? (agent?.id ?? null) : null;
      const resolved = t.status === 'RESOLVED' || t.status === 'CLOSED';
      await db.transaction(async (tx) => {
        const code = await sequences.code('TK', 'ticket', 6, tx);
        const [row] = await tx
          .insert(tickets)
          .values({
            code, subject: t.subject, category: t.category, priority: t.priority, status: t.status, brandId: brand.id, orderId: order?.id ?? null,
            customerId: t.openedBy === 'CUSTOMER' ? (order?.customerId ?? null) : null, openedById: openerId, openedByType: t.openedBy,
            contactName: t.openedBy === 'CUSTOMER' ? (order?.recipientName ?? 'Customer') : null,
            contactPhone: t.openedBy === 'CUSTOMER' ? (order?.recipientPhone ?? '+201099999999') : null,
            assigneeId: t.status === 'OPEN' ? null : (agent?.id ?? null), slaDueAt: slaDue(openedAt, t.priority),
            resolvedAt: resolved ? new Date(openedAt.getTime() + 6 * 3_600_000) : null, createdAt: openedAt,
          })
          .$returningId();
        let minute = 0;
        for (const m of t.thread) {
          minute += 25;
          await tx.insert(ticketMessages).values({
            ticketId: row.id, authorType: m.by, isInternal: !!m.internal, body: m.body,
            authorId: m.by === 'STAFF' ? (agent?.id ?? null) : m.by === 'BRAND' ? ownerId : null,
            authorName: m.by === 'STAFF' ? (agent?.name ?? 'GoTurtle Support') : m.by === 'BRAND' ? brand.name : m.by === 'SYSTEM' ? 'GoTurtle' : (order?.recipientName ?? 'Customer'),
            createdAt: new Date(openedAt.getTime() + minute * 60_000),
          });
        }
      });
      created++;
    }
    summary.push(`${created} tickets`);
  }

  // In-app notifications
  const [{ n: inAppCount }] = await db.select({ n: count() }).from(notifications).where(eq(notifications.channel, 'IN_APP'));
  if (!Number(inAppCount)) {
    let sent = 0;
    sent += await notify.notifyRoles(['SUPER_ADMIN', 'OPS_MANAGER'], 'brand_registered', { brand: 'Lotus Home', code: 'LOTUSHOM' }, { data: { link: '/ops/brands' } });
    sent += await notify.notifyRoles(['SUPPORT'], 'ticket_created', { code: 'TK-000001', subject: 'Order is two days late', priority: 'high' }, { data: { link: '/ops/tickets' } });
    for (const b of brandRows) {
      sent += await notify.notifyBrandOwners(b.id, 'settlement_paid', { code: `ST-${b.code}-DEMO`, amount: '12,450 ج.م.', period: 'last week', reference: 'INSTAPAY-DEMO' }, { data: { link: '/brand/finance' } });
    }
    if (nile) sent += await notify.notifyBrandOwners(nile.id, 'ticket_reply', { code: 'TK-000001', link: '' }, { data: { link: '/brand/support' } });
    summary.push(`${sent} in-app notifications`);
  }

  // One invited staff user who has not signed in yet
  const invitedPhone = '+201000000006';
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.phone, invitedPhone)).limit(1);
  if (!existing) {
    await db.transaction((tx) =>
      usersService.createAccount(tx, { name: 'Rana Hamdy', phone: invitedPhone, email: 'rana@goturtle.eg', role: 'SUPPORT', locale: 'ar', password: DEMO_PASSWORD }),
    );
    summary.push('1 invited staff user');
  }

  console.log(`✔ platform demo: ${summary.length ? summary.join(', ') : 'nothing to add'}`);
}
