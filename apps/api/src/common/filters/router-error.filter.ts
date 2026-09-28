import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import {
  RouterAuthError,
  RouterCommandError,
  RouterConnectionError,
  RouterError,
  RouterNotFoundError,
} from '../../mikrotik/errors';

/** Maps connector errors to HTTP responses the panel can present meaningfully. */
@Catch(RouterConnectionError, RouterAuthError, RouterCommandError, RouterNotFoundError)
export class RouterErrorFilter implements ExceptionFilter {
  catch(err: RouterError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, code] =
      err instanceof RouterConnectionError
        ? [HttpStatus.GATEWAY_TIMEOUT, 'ROUTER_UNREACHABLE']
        : err instanceof RouterAuthError
          ? [HttpStatus.BAD_GATEWAY, 'ROUTER_AUTH_FAILED']
          : err instanceof RouterNotFoundError
            ? [HttpStatus.NOT_FOUND, 'ROUTER_ITEM_NOT_FOUND']
            : [HttpStatus.UNPROCESSABLE_ENTITY, 'ROUTER_REJECTED'];
    res.status(status).json({ statusCode: status, code, message: err.message });
  }
}
