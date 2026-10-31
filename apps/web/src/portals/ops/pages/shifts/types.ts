export type ShiftTemplate = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  hubId: string | null;
  zoneId: string | null;
  requiredCouriers: number;
  hourlyRateCents: number | null;
  breakMinutes: number;
  isActive: boolean;
  overnight: boolean;
  lengthMinutes: number;
  paidMinutes: number;
  hub: { id: string; name: string; code: string } | null;
  zone: { id: string; code: string; nameEn: string; nameAr: string } | null;
};

export type CoverageLine = {
  templateId: string;
  templateName: string;
  hubId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  required: number;
  scheduled: number;
  gap: number;
  byStatus: Record<string, number>;
};

export type Coverage = {
  from: string;
  to: string;
  totals: { required: number; scheduled: number; gap: number; coveragePct: number };
  lines: CoverageLine[];
};

export type GenerateResult = {
  created: number;
  skipped: Array<{ courierId: string; date: string; reason: string }>;
};
