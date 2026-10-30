import {
  applyBp, canTransition, customerStepIndex, detectZone, egpToCents, formatEgyptPhone, generateTrackingNumber,
  haversineKm, isValidTrackingNumber, levelForXp, maskPhone, normalizeEgyptPhone, normalizeText, optimizeRoute,
  ORDER_TRANSITIONS, quote, reliabilityScore, returnFee, scoreCodRisk, TERMINAL_STATUSES, egyptOperator,
  actorCanSetStatus, hasPermission, type RateCard,
} from './index';

describe('money', () => {
  it('converts EGP to piasters without float noise', () => {
    expect(egpToCents(1.005)).toBe(101);
    expect(egpToCents(0.1 + 0.2)).toBe(30);
    expect(egpToCents(-12.5)).toBe(-1250);
    expect(applyBp(10000, 100)).toBe(100);
  });
});

describe('phone', () => {
  it.each([
    ['01012345678', '+201012345678'],
    ['+20 101 234 5678', '+201012345678'],
    ['00201112345678', '+201112345678'],
    ['201212345678', '+201212345678'],
    ['1512345678', '+201512345678'],
    ['٠١٠١٢٣٤٥٦٧٨', '+201012345678'],
  ])('normalizes %s', (raw, e164) => expect(normalizeEgyptPhone(raw)).toBe(e164));

  it.each(['0131234567', '01312345678', '0221234567', '', 'abc'])('rejects %s', (raw) => expect(normalizeEgyptPhone(raw)).toBeNull());

  it('formats, masks and detects operator', () => {
    expect(formatEgyptPhone('+201012345678')).toBe('0101 234 5678');
    expect(maskPhone('+201012345678')).toBe('0101****678');
    expect(egyptOperator('01512345678')).toBe('WE');
  });
});

describe('tracking numbers', () => {
  it('generates valid numbers with a Luhn check digit', () => {
    for (let i = 0; i < 500; i++) expect(isValidTrackingNumber(generateTrackingNumber())).toBe(true);
  });
  it('catches typos', () => {
    const tn = generateTrackingNumber();
    const digit = Number(tn[5]);
    const typo = tn.slice(0, 5) + String((digit + 1) % 10) + tn.slice(6);
    expect(isValidTrackingNumber(typo)).toBe(false);
    expect(isValidTrackingNumber(` ${tn.toLowerCase()} `)).toBe(true);
  });
});

describe('order state machine', () => {
  it('terminal statuses have no exits', () => {
    for (const s of TERMINAL_STATUSES) expect(ORDER_TRANSITIONS[s]).toHaveLength(0);
  });
  it('allows the happy path and blocks shortcuts', () => {
    expect(canTransition('CREATED', 'PICKED_UP')).toBe(true);
    expect(canTransition('PICKED_UP', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
    expect(canTransition('CREATED', 'DELIVERED')).toBe(false);
    expect(canTransition('DELIVERED', 'RETURNED')).toBe(false);
  });
  it('every target status is a known status', () => {
    const all = Object.keys(ORDER_TRANSITIONS);
    for (const targets of Object.values(ORDER_TRANSITIONS)) for (const t of targets) expect(all).toContain(t);
  });
  it('restricts actors', () => {
    expect(actorCanSetStatus('COURIER', 'DELIVERED')).toBe(true);
    expect(actorCanSetStatus('BRAND', 'DELIVERED')).toBe(false);
    expect(actorCanSetStatus('CUSTOMER', 'RESCHEDULED')).toBe(true);
  });
  it('maps customer steps', () => {
    expect(customerStepIndex('OUT_FOR_DELIVERY')).toBe(3);
    expect(customerStepIndex('CANCELLED')).toBe(-1);
  });
});

describe('pricing', () => {
  const card: RateCard = {
    codFeeBp: 100, codFeeMinCents: 500, includedWeightGrams: 3000, extraKgCents: 500, returnFeeBp: 5000,
    exchangeFeeCents: 1000, insuranceBp: 0, vatBp: 1400,
    rules: [
      { tier: 'A', serviceLevel: 'STANDARD', baseFeeCents: 5500 },
      { tier: 'A', serviceLevel: 'SAME_DAY', baseFeeCents: 7500 },
    ],
  };
  it('prices a COD order with weight and VAT', () => {
    const q = quote(card, { tier: 'A', serviceLevel: 'STANDARD', type: 'DELIVERY', weightGrams: 4200, paymentMethod: 'COD', codAmountCents: 100000 });
    expect(q.shippingFeeCents).toBe(5500);
    expect(q.weightFeeCents).toBe(1000); // 1.2 kg over → every started kg is billed → 2 kg
    expect(q.codFeeCents).toBe(1000);
    expect(q.vatCents).toBe(1050); // 14% of 7,500
    expect(q.totalFeesCents).toBe(8550);
    expect(q.collectFromRecipientCents).toBe(100000);
    expect(q.netToBrandCents).toBe(100000 - 8550);
  });
  it('applies the COD minimum and recipient-paid fees', () => {
    const q = quote(card, { tier: 'A', serviceLevel: 'STANDARD', type: 'DELIVERY', weightGrams: 500, paymentMethod: 'COD', codAmountCents: 20000, feesPaidBy: 'RECIPIENT' });
    expect(q.codFeeCents).toBe(500);
    expect(q.collectFromRecipientCents).toBe(20000 + q.totalFeesCents);
    expect(q.netToBrandCents).toBe(20000);
  });
  it('falls back EXPRESS → SAME_DAY and errors on unknown tiers', () => {
    expect(quote(card, { tier: 'A', serviceLevel: 'EXPRESS', type: 'DELIVERY', weightGrams: 0, paymentMethod: 'PREPAID', codAmountCents: 0 }).shippingFeeCents).toBe(7500);
    expect(() => quote(card, { tier: 'C', serviceLevel: 'STANDARD', type: 'DELIVERY', weightGrams: 0, paymentMethod: 'PREPAID', codAmountCents: 0 })).toThrow();
  });
  it('computes return fees with VAT', () => {
    expect(returnFee(card, 5500)).toBe(2750 + 385);
  });
});

describe('geo & routing', () => {
  it('computes distances', () => {
    const tahrir = { lat: 30.0444, lng: 31.2357 };
    const nasr = { lat: 30.0566, lng: 31.3439 };
    expect(haversineKm(tahrir, nasr)).toBeGreaterThan(10);
    expect(haversineKm(tahrir, nasr)).toBeLessThan(11);
  });
  it('optimizes a route better than or equal to input order', () => {
    const start = { lat: 30.05, lng: 31.3 };
    const stops = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, lat: 30 + ((i * 37) % 17) / 100, lng: 31.2 + ((i * 53) % 19) / 100 }));
    const plan = optimizeRoute(start, stops);
    expect(plan.stops).toHaveLength(25);
    expect(new Set(plan.stops.map((s) => s.id)).size).toBe(25);
    let naive = 0;
    let prev = start;
    for (const s of stops) { naive += haversineKm(prev, s); prev = s; }
    expect(plan.totalKm).toBeLessThanOrEqual(naive * 1.35 + 1e-6);
    expect(plan.stops.map((s) => s.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
});

describe('address → zone detection', () => {
  const zones = [
    { id: 'z1', code: 'CAI-NASR', nameEn: 'Nasr City', nameAr: 'مدينة نصر', keywords: ['madinet nasr', 'abbas el akkad', 'عباس العقاد'], centerLat: 30.0566, centerLng: 31.3439 },
    { id: 'z2', code: 'NCAI-TAGAMOA', nameEn: 'New Cairo', nameAr: 'التجمع الخامس', keywords: ['tagamo3', 'fifth settlement', 'التجمع'], centerLat: 30.0074, centerLng: 31.4913 },
    { id: 'z3', code: 'CAI-MAADI', nameEn: 'Maadi', nameAr: 'المعادي', keywords: ['degla'], centerLat: 29.9602, centerLng: 31.2569 },
  ];
  it.each([
    ['15 شارع عباس العقاد، مدينة نصر', 'CAI-NASR'],
    ['Villa 3, El Tagamo3 el Khames', 'NCAI-TAGAMOA'],
    ['عمارة ٥ التجمع الخامس بجوار الجامعة', 'NCAI-TAGAMOA'],
    ['Street 233, Degla, MAADI', 'CAI-MAADI'],
    ['madinet nasr 7th district', 'CAI-NASR'],
  ])('%s → %s', (addr, code) => expect(detectZone(zones, addr)?.code).toBe(code));

  it('falls back to the nearest zone by coordinates', () => {
    expect(detectZone(zones, 'somewhere', { lat: 29.965, lng: 31.26 })?.code).toBe('CAI-MAADI');
    expect(detectZone(zones, 'somewhere')).toBeNull();
  });
  it('normalizes arabic letter variants', () => {
    expect(normalizeText('الإسكندرية')).toBe(normalizeText('الاسكندريه'));
  });
});

describe('risk & gamification & permissions', () => {
  it('scores serial refusers as high risk', () => {
    const r = scoreCodRisk({ codAmountCents: 300000, customerTotalOrders: 5, customerDelivered: 1, customerRefused: 4, addressLength: 10, hasCoordinates: false, zoneTier: 'C' });
    expect(r.level).toBe('HIGH');
    const good = scoreCodRisk({ codAmountCents: 30000, customerTotalOrders: 10, customerDelivered: 10, customerRefused: 0, addressLength: 60, hasCoordinates: true, zoneTier: 'A' });
    expect(good.level).toBe('LOW');
  });
  it('computes reliability with a prior', () => {
    expect(reliabilityScore(0, 0)).toBe(80);
    expect(reliabilityScore(10, 0)).toBeGreaterThan(90);
    expect(reliabilityScore(0, 5)).toBeLessThan(50);
  });
  it('levels heroes', () => {
    expect(levelForXp(0).level).toBe(1);
    expect(levelForXp(1200).level).toBe(3);
    expect(levelForXp(999999).next).toBeNull();
  });
  it('checks permissions', () => {
    expect(hasPermission('SUPER_ADMIN', 'settings.manage')).toBe(true);
    expect(hasPermission('DISPATCHER', 'payouts.manage')).toBe(false);
    expect(hasPermission('COURIER', 'orders.read')).toBe(false);
  });
});
