import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@goturtle/shared';
import type { ActorKind, Principal } from './principal';

export const IS_PUBLIC = 'gt:isPublic';
export const ACCESS = 'gt:access';

/** No authentication required (a token is still parsed if present). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AccessRule {
  /** Which kinds of principals may call. Default: ['staff']. */
  actors?: ActorKind[];
  /** All listed permissions are required (checked for staff, brand users and API keys). */
  permissions?: Permission[];
}

/**
 * Declare who may call a route/controller.
 *   @Access({ actors: ['staff', 'brand', 'apiKey'], permissions: ['orders.create'] })
 * Routes without @Access or @Public are staff-only.
 */
export const Access = (rule: AccessRule) => SetMetadata(ACCESS, rule);

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest().principal;
});

/** Client IP and user agent for audit logs. */
export const RequestMeta = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return { ip: (req.ip as string | undefined) ?? null, userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null };
});
export type RequestMetaInfo = { ip: string | null; userAgent: string | null };
