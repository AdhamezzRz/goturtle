import { HttpStatus } from '@nestjs/common';

/**
 * Business-rule violation with a stable machine-readable code the portals can
 * translate (e.g. INVALID_TRANSITION, CASH_LIMIT_EXCEEDED, OTP_INVALID).
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = HttpStatus.UNPROCESSABLE_ENTITY,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (entity: string, id?: string) =>
  new DomainError('NOT_FOUND', `${entity}${id ? ` ${id}` : ''} not found`, HttpStatus.NOT_FOUND);
