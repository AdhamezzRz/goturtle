import { cairoDateTime } from '../../db/helpers';
import { addDays, MINUTE_MS } from '../couriers/workforce.util';

/** Minutes of tolerance before a clock-in counts as late. */
export const LATE_GRACE_MINUTES = 5;
/** A shift with no clock-in this long after its start is marked MISSED. */
export const MISSED_AFTER_MINUTES = 30;
/** IN_PROGRESS shifts are clocked out automatically this long after their end. */
export const AUTO_CLOCK_OUT_AFTER_MINUTES = 240;
/** Heroes may clock in at most this early. */
export const EARLY_CLOCK_IN_MINUTES = 30;
/** SHIFT heroes may go ONLINE this long before a booked shift starts. */
export const ONLINE_BEFORE_SHIFT_MINUTES = 15;
/** Clock-in/out farther than this from the shift's hub is flagged. */
export const GEOFENCE_RADIUS_KM = 0.5;
export const MAX_SHIFT_MINUTES = 16 * 60;

const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / MINUTE_MS);

/** Concrete UTC bounds of a template occurrence on a Cairo day (overnight shifts end the next day). */
export function shiftBounds(day: string, startTime: string, endTime: string): { startAt: Date; endAt: Date } {
  const startAt = cairoDateTime(day, startTime);
  const endDay = endTime <= startTime ? addDays(day, 1) : day;
  return { startAt, endAt: cairoDateTime(endDay, endTime) };
}

/** Scheduled paid minutes: shift length minus the break (never negative). */
export function scheduledMinutes(startAt: Date, endAt: Date, breakMinutes: number): number {
  return Math.max(0, minutesBetween(startAt, endAt) - breakMinutes);
}

/** Late minutes after the grace period (the full lateness counts once beyond the grace). */
export function lateMinutes(startAt: Date, clockInAt: Date, graceMinutes = LATE_GRACE_MINUTES): number {
  const late = minutesBetween(startAt, clockInAt);
  return late > graceMinutes ? late : 0;
}

export interface AttendanceResult {
  workedMinutes: number;
  overtimeMinutes: number;
  scheduledMinutes: number;
  earningsCents: number;
}

/**
 * Worked = clock-out − clock-in − break (≥ 0); overtime = worked beyond the
 * scheduled length; pay = round(hourlyRate × worked / 60). With `capAtScheduled`
 * (automatic clock-out) the worked time never exceeds the schedule.
 */
export function computeAttendance(
  s: { startAt: Date; endAt: Date; breakMinutes: number; hourlyRateCents: number },
  clockInAt: Date,
  clockOutAt: Date,
  opts: { capAtScheduled?: boolean } = {},
): AttendanceResult {
  const scheduled = scheduledMinutes(s.startAt, s.endAt, s.breakMinutes);
  let worked = Math.max(0, minutesBetween(clockInAt, clockOutAt) - s.breakMinutes);
  if (opts.capAtScheduled) worked = Math.min(worked, scheduled);
  const overtime = Math.max(0, worked - scheduled);
  return { workedMinutes: worked, overtimeMinutes: overtime, scheduledMinutes: scheduled, earningsCents: Math.round((s.hourlyRateCents * worked) / 60) };
}
