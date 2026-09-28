import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuditResult } from '@prisma/client';
import * as argon2 from 'argon2';
import * as QRCode from 'qrcode';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth/decorators';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from './session.service';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const ISSUER = 'MikroTik NMS';

// Verifying against a dummy hash for unknown users keeps response time uniform (no username enumeration).
const DUMMY_HASH_PROMISE = argon2.hash('timing-equaliser-not-a-real-password');

export class TwoFactorRequiredError extends UnauthorizedException {
  constructor() {
    super({ message: 'Two-factor code required', requires2fa: true });
  }
}

@Injectable()
export class AuthService {
  /** Last accepted TOTP step per user — prevents replaying a code inside its validity window. */
  private readonly lastTotpStep = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }

  async login(username: string, password: string, totpCode: string | undefined, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    const fail = async (reason: string) => {
      await this.audit.record({
        action: 'AUTH_LOGIN',
        user: { id: user?.id, username },
        meta,
        result: AuditResult.FAILURE,
        error: reason,
      });
      return new UnauthorizedException('Invalid credentials');
    };

    if (!user) {
      await argon2.verify(await DUMMY_HASH_PROMISE, password).catch(() => false);
      throw await fail('unknown user');
    }
    if (!user.isActive) throw await fail('user disabled');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw await fail('account locked');

    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : undefined,
        },
      });
      throw await fail(failed >= MAX_FAILED_LOGINS ? 'bad password, account locked' : 'bad password');
    }

    if (user.totpEnabled) {
      if (!totpCode) throw new TwoFactorRequiredError();
      if (!this.checkTotp(user.id, user.totpSecretEnc!, totpCode)) throw await fail('bad 2fa code');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: meta.ip },
    });
    const session = await this.sessions.create(user.id, meta.ip, meta.userAgent);
    await this.audit.record({
      action: 'AUTH_LOGIN',
      user: { id: user.id, username: user.username },
      meta,
      result: AuditResult.SUCCESS,
    });
    return session;
  }

  async logout(user: AuthUser, meta: RequestMeta) {
    await this.sessions.revoke(user.sessionId);
    await this.audit.record({ action: 'AUTH_LOGOUT', user, meta, result: AuditResult.SUCCESS });
  }

  async me(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { id: true, username: true, fullName: true, email: true, totpEnabled: true, lastLoginAt: true },
    });
    return { ...u, role: user.role, permissions: [...user.permissions].sort() };
  }

  async changePassword(user: AuthUser, current: string, next: string, meta: RequestMeta) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await argon2.verify(u.passwordHash, current))) throw new BadRequestException('Current password is wrong');
    await this.audit.track({ action: 'AUTH_PASSWORD_CHANGE', user, meta }, async () => {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await AuthService.hashPassword(next) },
      });
      await this.sessions.revokeAllForUser(user.id, user.sessionId);
    });
  }

  /** Step 1: generate a secret (not yet active) and return the provisioning QR code. */
  async setupTotp(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (u.totpEnabled) throw new BadRequestException('Two-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpSecretEnc: this.crypto.encrypt(secret, `totp:${user.id}`) },
    });
    const url = otpauthUrl(secret, u.username, ISSUER);
    return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url) };
  }

  /** Step 2: confirm the user's authenticator works, then activate. */
  async enableTotp(user: AuthUser, code: string, meta: RequestMeta) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.totpSecretEnc || u.totpEnabled) throw new BadRequestException('Run 2FA setup first');
    if (!this.checkTotp(user.id, u.totpSecretEnc, code)) throw new BadRequestException('Invalid code');
    await this.audit.track({ action: 'AUTH_2FA_ENABLE', user, meta }, () =>
      this.prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } }),
    );
  }

  async disableTotp(user: AuthUser, password: string, code: string, meta: RequestMeta) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.totpEnabled) throw new BadRequestException('Two-factor authentication is not enabled');
    const ok = (await argon2.verify(u.passwordHash, password)) && this.checkTotp(user.id, u.totpSecretEnc!, code);
    if (!ok) throw new BadRequestException('Invalid password or code');
    await this.audit.track({ action: 'AUTH_2FA_DISABLE', user, meta }, () =>
      this.prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecretEnc: null } }),
    );
  }

  private checkTotp(userId: string, secretEnc: string, code: string): boolean {
    const secret = this.crypto.decrypt(secretEnc, `totp:${userId}`);
    const step = verifyTotp(secret, code);
    if (step === null) return false;
    if ((this.lastTotpStep.get(userId) ?? -1) >= step) return false;
    this.lastTotpStep.set(userId, step);
    return true;
  }
}
