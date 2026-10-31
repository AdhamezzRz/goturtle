import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import { carrierPartners, couriers } from '../../db/schema';
import { partnerTrackingUrl, virtualCourierCode } from './partner-adapters';

export interface PartnerTrackingInfo {
  name: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  handedAt: Date | null;
}

/**
 * "Delivered by <partner>" block of the public tracking page: only while the
 * parcel is (or was delivered) with the partner's virtual hero — once a partner
 * brings it back and our own hero takes over, the partner is no longer shown.
 */
export async function partnerTrackingInfo(
  db: DbOrTx,
  o: { partnerCarrierId: string | null; partnerTrackingNumber: string | null; handedToPartnerAt: Date | null; courierId: string | null },
): Promise<PartnerTrackingInfo | null> {
  if (!o.partnerCarrierId || !o.courierId) return null;
  const [p] = await db
    .select({ name: carrierPartners.name, code: carrierPartners.code, template: carrierPartners.trackingUrlTemplate, courierCode: couriers.code })
    .from(carrierPartners)
    .innerJoin(couriers, eq(couriers.id, o.courierId))
    .where(eq(carrierPartners.id, o.partnerCarrierId))
    .limit(1);
  if (!p || p.courierCode !== virtualCourierCode(p.code)) return null;
  return { name: p.name, trackingNumber: o.partnerTrackingNumber, trackingUrl: partnerTrackingUrl(p.template, o.partnerTrackingNumber), handedAt: o.handedToPartnerAt };
}
