import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SESSION_COOKIE, SessionService } from '../../auth/session.service';
import { AuthedRequest, IS_PUBLIC, PERMISSIONS_KEY } from './decorators';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'mikrotik-nms';

/**
 * CSRF defence in depth. The session cookie is SameSite=Strict already; on top of that every
 * state-changing request must carry a custom header, which a cross-site form or <img> cannot set
 * and a cross-origin fetch cannot send without passing the CORS allowlist.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
      throw new ForbiddenException('Missing CSRF header');
    }
    return true;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.sessions.resolve(req.cookies?.[SESSION_COOKIE]);
    if (!user) throw new UnauthorizedException();
    req.user = user;
    return true;
  }
}

/**
 * Deny by default: an authenticated endpoint without @RequirePermissions is only reachable
 * if it is explicitly marked with @RequirePermissions() (empty = any authenticated user).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const rule = this.reflector.getAllAndOverride<{ all?: string[]; any?: string[] } | undefined>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!rule) throw new ForbiddenException('Endpoint has no permission policy');

    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw new UnauthorizedException();
    if (rule.all && !rule.all.every((p) => user.permissions.has(p))) throw new ForbiddenException();
    if (rule.any && !rule.any.some((p) => user.permissions.has(p))) throw new ForbiddenException();
    return true;
  }
}
