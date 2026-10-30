import type { UserRole } from './enums';

/**
 * Fine-grained permissions. Controllers declare `@RequirePermissions(...)`,
 * the API guard checks them against ROLE_PERMISSIONS, and the web app uses the
 * same table to hide what a user cannot do.
 */
export const PERMISSIONS = [
  'orders.read', 'orders.create', 'orders.update', 'orders.cancel', 'orders.status', 'orders.export',
  'pickups.read', 'pickups.manage',
  'dispatch.manage', 'runsheets.read', 'runsheets.manage',
  'hubs.scan', 'network.read', 'network.manage',
  'brands.read', 'brands.manage',
  'couriers.read', 'couriers.manage', 'couriers.track',
  'shifts.read', 'shifts.manage',
  'cash.read', 'cash.manage',
  'finance.read', 'finance.manage', 'settlements.manage', 'payouts.manage', 'pricing.manage',
  'tickets.read', 'tickets.manage',
  'analytics.read',
  'users.read', 'users.manage',
  'integrations.manage', 'settings.manage', 'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS] as Permission[];

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  SUPER_ADMIN: ALL,
  OPS_MANAGER: ALL.filter((p) => !['settings.manage', 'users.manage', 'payouts.manage', 'settlements.manage'].includes(p)),
  DISPATCHER: [
    'orders.read', 'orders.update', 'orders.status', 'orders.export', 'pickups.read', 'pickups.manage',
    'dispatch.manage', 'runsheets.read', 'runsheets.manage', 'hubs.scan', 'network.read', 'brands.read',
    'couriers.read', 'couriers.track', 'shifts.read', 'tickets.read', 'analytics.read', 'cash.read',
  ],
  HUB_OPERATOR: [
    'orders.read', 'orders.status', 'pickups.read', 'hubs.scan', 'runsheets.read', 'network.read',
    'couriers.read', 'cash.read', 'cash.manage', 'shifts.read',
  ],
  FINANCE: [
    'orders.read', 'orders.export', 'brands.read', 'couriers.read', 'cash.read', 'cash.manage',
    'finance.read', 'finance.manage', 'settlements.manage', 'payouts.manage', 'pricing.manage',
    'analytics.read', 'audit.read', 'runsheets.read', 'shifts.read', 'network.read',
  ],
  SUPPORT: [
    'orders.read', 'orders.update', 'orders.status', 'brands.read', 'couriers.read', 'couriers.track',
    'tickets.read', 'tickets.manage', 'network.read', 'pickups.read', 'runsheets.read',
  ],
  // Brand & courier users are scoped to their own records by the services; these
  // permissions only open the endpoints.
  BRAND_OWNER: ['orders.read', 'orders.create', 'orders.update', 'orders.cancel', 'orders.export', 'pickups.read', 'pickups.manage', 'finance.read', 'tickets.read', 'tickets.manage', 'integrations.manage', 'users.read', 'users.manage', 'analytics.read', 'network.read'],
  BRAND_STAFF: ['orders.read', 'orders.create', 'orders.update', 'orders.cancel', 'orders.export', 'pickups.read', 'pickups.manage', 'tickets.read', 'tickets.manage', 'analytics.read', 'network.read'],
  COURIER: [],
};

export const STAFF_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'OPS_MANAGER', 'DISPATCHER', 'HUB_OPERATOR', 'FINANCE', 'SUPPORT'];
export const BRAND_ROLES: readonly UserRole[] = ['BRAND_OWNER', 'BRAND_STAFF'];

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isStaffRole(role: UserRole): boolean {
  return STAFF_ROLES.includes(role);
}

export function isBrandRole(role: UserRole): boolean {
  return BRAND_ROLES.includes(role);
}
