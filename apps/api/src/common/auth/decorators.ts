import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission } from '../rbac/permissions';

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  sessionId: string;
  permissions: Set<string>;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export const IS_PUBLIC = 'isPublic';
/** Skips authentication (login, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS_KEY = 'permissions';
/**
 * Requires ALL listed permissions. Use {@link RequireAnyPermission} for "one of".
 */
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(PERMISSIONS_KEY, { all: perms });
export const RequireAnyPermission = (...perms: Permission[]) => SetMetadata(PERMISSIONS_KEY, { any: perms });

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user!;
});

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
});
