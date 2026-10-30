import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from './errors';

interface MysqlLikeError {
  code?: string;
  errno?: number;
  sqlMessage?: string;
  cause?: MysqlLikeError;
}

/**
 * Uniform error envelope: { statusCode, error, message, code?, details?, path, timestamp }.
 * Maps MySQL constraint errors to 409/400 so clients never see a raw 500 for a duplicate.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let code: string | undefined;
    let details: unknown;

    if (exception instanceof DomainError) {
      status = exception.status;
      message = exception.message;
      code = exception.code;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else {
        const b = body as { message?: string | string[]; code?: string; details?: unknown };
        message = b.message ?? exception.message;
        code = b.code;
        details = b.details;
      }
    } else {
      const db = mysqlError(exception);
      if (db?.code === 'ER_DUP_ENTRY') {
        status = HttpStatus.CONFLICT;
        message = 'A record with the same unique value already exists';
        code = 'DUPLICATE';
        details = { constraint: /for key '([^']+)'/.exec(db.sqlMessage ?? '')?.[1] };
      } else if (db?.code === 'ER_NO_REFERENCED_ROW_2' || db?.code === 'ER_NO_REFERENCED_ROW') {
        status = HttpStatus.BAD_REQUEST;
        message = 'Referenced record does not exist';
        code = 'INVALID_REFERENCE';
      } else if (db?.code === 'ER_ROW_IS_REFERENCED_2' || db?.code === 'ER_ROW_IS_REFERENCED') {
        status = HttpStatus.CONFLICT;
        message = 'Record is in use and cannot be deleted';
        code = 'IN_USE';
      } else if (db?.code === 'ER_LOCK_DEADLOCK' || db?.code === 'ER_LOCK_WAIT_TIMEOUT') {
        status = HttpStatus.SERVICE_UNAVAILABLE;
        message = 'The system is busy, please retry';
        code = 'RETRY';
      }
    }

    if (status >= 500) {
      this.log.error(`${req.method} ${req.originalUrl} → ${status}`, exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
      ...(code ? { code } : {}),
      ...(details !== undefined ? { details } : {}),
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }
}

function mysqlError(e: unknown): MysqlLikeError | null {
  let cur = e as MysqlLikeError | undefined;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur.code && cur.code.startsWith('ER_')) return cur;
    cur = cur.cause;
  }
  return null;
}
