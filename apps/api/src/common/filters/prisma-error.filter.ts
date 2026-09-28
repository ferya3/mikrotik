import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Turns constraint violations into client errors instead of generic 500s. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaErrorFilter implements ExceptionFilter {
  catch(err: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const fields = (err.meta?.target as string[] | undefined)?.join(', ');
    const [status, message] =
      err.code === 'P2002'
        ? [HttpStatus.CONFLICT, `Already exists${fields ? ` (${fields})` : ''}`]
        : err.code === 'P2025'
          ? [HttpStatus.NOT_FOUND, 'Record not found']
          : err.code === 'P2003'
            ? [HttpStatus.BAD_REQUEST, 'Referenced record does not exist']
            : [HttpStatus.INTERNAL_SERVER_ERROR, 'Database error'];
    res.status(status).json({ statusCode: status, message });
  }
}
