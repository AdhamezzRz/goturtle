import type { ReactNode } from 'react';
import { Ban, Banknote, CalendarClock, Compass, DoorClosed, Ellipsis, MapPinOff, MapPinned, PackageX, PhoneOff, ShieldAlert } from 'lucide-react';
import type { FailureReason } from '@goturtle/shared';

/** Failure reasons in the order heroes hit them most, with icons. Labels: hero.reason.<KEY>. */
export const FAILURE_REASONS: Array<{ value: FailureReason; icon: ReactNode }> = [
  { value: 'CUSTOMER_UNREACHABLE', icon: <PhoneOff /> },
  { value: 'CUSTOMER_NOT_PRESENT', icon: <DoorClosed /> },
  { value: 'CUSTOMER_RESCHEDULED', icon: <CalendarClock /> },
  { value: 'CUSTOMER_REFUSED', icon: <Ban /> },
  { value: 'NO_CASH', icon: <Banknote /> },
  { value: 'WRONG_ADDRESS', icon: <MapPinOff /> },
  { value: 'INCOMPLETE_ADDRESS', icon: <MapPinned /> },
  { value: 'OUT_OF_ZONE', icon: <Compass /> },
  { value: 'SECURITY_ACCESS', icon: <ShieldAlert /> },
  { value: 'PACKAGE_DAMAGED', icon: <PackageX /> },
  { value: 'OTHER', icon: <Ellipsis /> },
];
