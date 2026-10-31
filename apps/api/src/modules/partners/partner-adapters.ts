/**
 * Partner carrier adapters. A MANUAL partner is driven by staff: they hand
 * parcels over with the partner's waybill numbers and record outcomes from
 * the partner's portal / sheet. An API partner implements this interface to
 * book shipments and report statuses programmatically; register it in
 * PARTNER_ADAPTERS under its apiType.
 */
export interface PartnerShipmentRequest {
  orderId: string;
  trackingNumber: string;
  recipient: { name: string; phone: string; altPhone: string | null };
  address: { line: string; building: string | null; floor: string | null; apartment: string | null; landmark: string | null; governorateCode: string; cityName: string; lat: number | null; lng: number | null };
  codAmountCents: number;
  weightGrams: number;
  itemsCount: number;
  description: string | null;
  allowOpening: boolean;
  /** Tracking number typed by staff (MANUAL partners). */
  partnerTrackingNumber: string | null;
}

export interface PartnerStatusReport {
  partnerTrackingNumber: string;
  outcome: 'DELIVERED' | 'FAILED' | 'RETURNED';
  collectedCents?: number;
  reason?: string;
  partnerReference?: string;
  at?: Date;
}

export interface PartnerAdapter {
  readonly type: string;
  /** Books the shipments with the partner; returns the partner tracking number per order (null when unknown). */
  createShipments(requests: PartnerShipmentRequest[], credentials: Record<string, string>): Promise<Array<{ orderId: string; partnerTrackingNumber: string | null }>>;
  /** Statuses that changed at the partner since the last poll (MANUAL partners report through the API instead). */
  pollStatuses(partnerTrackingNumbers: string[], credentials: Record<string, string>): Promise<PartnerStatusReport[]>;
}

/** Staff-operated partner: tracking numbers come from the handoff form, outcomes from POST /partners/:id/status. */
export const manualAdapter: PartnerAdapter = {
  type: 'MANUAL',
  async createShipments(requests) {
    return requests.map((r) => ({ orderId: r.orderId, partnerTrackingNumber: r.partnerTrackingNumber?.trim() || null }));
  },
  async pollStatuses() {
    return [];
  },
};

export const PARTNER_ADAPTERS: Readonly<Record<string, PartnerAdapter>> = { MANUAL: manualAdapter };
export const PARTNER_API_TYPES = Object.keys(PARTNER_ADAPTERS) as Array<keyof typeof PARTNER_ADAPTERS & string>;
export type PartnerApiType = (typeof PARTNER_API_TYPES)[number];

export function adapterFor(apiType: string): PartnerAdapter {
  return PARTNER_ADAPTERS[apiType] ?? manualAdapter;
}

/** https://partner.example/track/{tn} → link for one shipment (null without template or number). */
export function partnerTrackingUrl(template: string | null | undefined, partnerTrackingNumber: string | null | undefined): string | null {
  if (!template || !partnerTrackingNumber) return null;
  return template.includes('{tn}') ? template.split('{tn}').join(encodeURIComponent(partnerTrackingNumber)) : `${template}${encodeURIComponent(partnerTrackingNumber)}`;
}

export const virtualCourierCode = (partnerCode: string) => `PT-${partnerCode}`;
/** Login identifier of the (disabled) virtual hero user — not a phone number, so it can never log in or get SMS. */
export const virtualUserPhone = (partnerCode: string) => `partner:${partnerCode}`.slice(0, 20);
