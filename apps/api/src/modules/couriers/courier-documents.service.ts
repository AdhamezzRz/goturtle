import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, lte, ne } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courierDocuments, couriers, users } from '../../db/schema';
import { InjectDb } from '../../core/database.module';
import { AuditService } from '../../core/audit.service';
import { DomainError, notFound } from '../../common/errors';
import type { Principal } from '../../common/principal';
import { principalUserId } from '../../common/principal';
import type { RequestMetaInfo } from '../../common/decorators';
import { cairoToday } from '../../db/helpers';
import { addDays, DAY_MS, dayDiff } from './workforce.util';
import type { CreateDocumentDto, ReviewDocumentDto } from './dto/couriers.dto';

/** Hero onboarding documents (ID, license, criminal record…) and their review. */
@Injectable()
export class CourierDocumentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(courierId: string) {
    await this.assertCourier(courierId);
    return this.db.select().from(courierDocuments).where(eq(courierDocuments.courierId, courierId)).orderBy(desc(courierDocuments.createdAt));
  }

  /** Adds a document (staff or the hero). A new upload of the same type supersedes nothing: reviewers see the history. */
  async create(courierId: string, dto: CreateDocumentDto, principal: Principal, meta: RequestMetaInfo | null) {
    const c = await this.assertCourier(courierId);
    if (c.status === 'OFFBOARDED') throw new DomainError('COURIER_OFFBOARDED', 'Hero is offboarded', HttpStatus.CONFLICT);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    const [row] = await this.db.insert(courierDocuments).values({ courierId, type: dto.type, url: dto.url, expiresAt, status: 'PENDING' }).$returningId();
    await this.audit.record(principal, { action: 'courier.document.create', entity: 'CourierDocument', entityId: row.id, after: { courierId, type: dto.type } }, meta);
    const [doc] = await this.db.select().from(courierDocuments).where(eq(courierDocuments.id, row.id)).limit(1);
    return doc;
  }

  async review(courierId: string, documentId: string, dto: ReviewDocumentDto, principal: Principal, meta: RequestMetaInfo) {
    const [doc] = await this.db.select().from(courierDocuments).where(and(eq(courierDocuments.id, documentId), eq(courierDocuments.courierId, courierId))).limit(1);
    if (!doc) throw notFound('Document', documentId);
    if (dto.status === 'REJECTED' && !dto.note?.trim()) throw new DomainError('NOTE_REQUIRED', 'Explain why the document is rejected', HttpStatus.BAD_REQUEST);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : doc.expiresAt;
    if (dto.status === 'APPROVED' && expiresAt && expiresAt.getTime() < Date.now()) {
      throw new DomainError('DOCUMENT_EXPIRED', 'An expired document cannot be approved', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    await this.db
      .update(courierDocuments)
      .set({ status: dto.status, reviewNote: dto.note?.trim() || null, reviewedById: principalUserId(principal), expiresAt })
      .where(eq(courierDocuments.id, documentId));
    await this.audit.record(principal, { action: 'courier.document.review', entity: 'CourierDocument', entityId: documentId, before: { status: doc.status }, after: { status: dto.status, note: dto.note ?? null } }, meta);
    const [updated] = await this.db.select().from(courierDocuments).where(eq(courierDocuments.id, documentId)).limit(1);
    return updated;
  }

  /** Approved/pending documents and driving licenses that expire within `days` (or already expired). */
  async expiring(days: number) {
    const cutoff = new Date(Date.now() + days * DAY_MS);
    const cutoffDay = addDays(cairoToday(), days);
    const docs = await this.db
      .select({
        id: courierDocuments.id, courierId: courierDocuments.courierId, type: courierDocuments.type, status: courierDocuments.status,
        url: courierDocuments.url, expiresAt: courierDocuments.expiresAt, code: couriers.code, name: users.name, phone: users.phone,
      })
      .from(courierDocuments)
      .innerJoin(couriers, eq(couriers.id, courierDocuments.courierId))
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(
        and(
          inArray(courierDocuments.status, ['APPROVED', 'PENDING']),
          isNotNull(courierDocuments.expiresAt),
          lte(courierDocuments.expiresAt, cutoff),
          ne(couriers.status, 'OFFBOARDED'),
        ),
      )
      .orderBy(asc(courierDocuments.expiresAt));
    const licenses = await this.db
      .select({ courierId: couriers.id, code: couriers.code, name: users.name, phone: users.phone, licenseNumber: couriers.licenseNumber, licenseExpiry: couriers.licenseExpiry })
      .from(couriers)
      .innerJoin(users, eq(users.id, couriers.userId))
      .where(and(isNotNull(couriers.licenseExpiry), lte(couriers.licenseExpiry, cutoffDay), ne(couriers.status, 'OFFBOARDED')))
      .orderBy(asc(couriers.licenseExpiry));
    const now = Date.now();
    const today = cairoToday();
    return {
      days,
      documents: docs.map((d) => ({ ...d, daysLeft: Math.floor((d.expiresAt!.getTime() - now) / DAY_MS), expired: d.expiresAt!.getTime() < now })),
      licenses: licenses.map((l) => ({ ...l, daysLeft: dayDiff(today, l.licenseExpiry!), expired: l.licenseExpiry! < today })),
    };
  }

  private async assertCourier(courierId: string) {
    const [c] = await this.db.select({ id: couriers.id, status: couriers.status }).from(couriers).where(eq(couriers.id, courierId)).limit(1);
    if (!c) throw notFound('Hero', courierId);
    return c;
  }
}
