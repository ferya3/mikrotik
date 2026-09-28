import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth/decorators';

export const SESSION_COOKIE = 'mtk_session';

interface SessionClaims {
  sub: string;
  sid: string;
}

/**
 * JWT in an httpOnly cookie + a server-side session row.
 * The JWT proves integrity; the row makes it revocable (logout, lockout, password change, role change).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(userId: string, ip?: string, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.config.sessionTtlSec * 1000);
    const session = await this.prisma.session.create({
      data: { id: randomUUID(), userId, ip, userAgent: userAgent?.slice(0, 255), expiresAt },
    });
    const token = await this.jwt.signAsync({ sub: userId, sid: session.id } satisfies SessionClaims, {
      expiresIn: this.config.sessionTtlSec,
    });
    return { token, expiresAt };
  }

  /** Returns the authenticated user, or null if the token/session is invalid, expired or revoked. */
  async resolve(token: string | undefined): Promise<AuthUser | null> {
    if (!token) return null;
    let claims: SessionClaims;
    try {
      claims = await this.jwt.verifyAsync<SessionClaims>(token);
    } catch {
      return null;
    }
    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      include: {
        user: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    if (!session || session.userId !== claims.sub) return null;
    if (session.revokedAt || session.expiresAt < new Date()) return null;
    const user = session.user;
    if (!user.isActive || (user.lockedUntil && user.lockedUntil > new Date())) return null;

    return {
      id: user.id,
      username: user.username,
      role: user.role.name,
      sessionId: session.id,
      permissions: new Set(user.role.permissions.map((rp) => rp.permission.key)),
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  cookieOptions(expiresAt: Date) {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'strict' as const,
      path: '/',
      expires: expiresAt,
    };
  }
}
