import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AuthUser, CurrentUser, Public, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth/decorators';
import { AuthService } from './auth.service';
import { SESSION_COOKIE, SessionService } from './session.service';

export const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/;
export const PASSWORD_POLICY_MSG = 'Password must be 12-128 characters with upper, lower case letters and a digit';

class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(64) username: string;
  @IsString() @IsNotEmpty() @MaxLength(128) password: string;
  @IsOptional() @Matches(/^\d{6}$/) totp?: string;
}

class ChangePasswordDto {
  @IsString() @IsNotEmpty() currentPassword: string;
  @Matches(PASSWORD_POLICY, { message: PASSWORD_POLICY_MSG }) newPassword: string;
}

class TotpCodeDto {
  @Length(6, 6) @Matches(/^\d{6}$/) code: string;
}

class DisableTotpDto extends TotpCodeDto {
  @IsString() @IsNotEmpty() password: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const { token, expiresAt } = await this.auth.login(dto.username, dto.password, dto.totp, meta);
    res.cookie(SESSION_COOKIE, token, this.sessions.cookieOptions(expiresAt));
    return { expiresAt };
  }

  @Post('logout')
  @HttpCode(204)
  @RequirePermissions()
  async logout(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user, meta);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  @RequirePermissions()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Post('password')
  @HttpCode(204)
  @RequirePermissions()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.changePassword(user, dto.currentPassword, dto.newPassword, meta);
  }

  @Post('2fa/setup')
  @RequirePermissions()
  setupTotp(@CurrentUser() user: AuthUser) {
    return this.auth.setupTotp(user);
  }

  @Post('2fa/enable')
  @HttpCode(204)
  @RequirePermissions()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  enableTotp(@CurrentUser() user: AuthUser, @Body() dto: TotpCodeDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.enableTotp(user, dto.code, meta);
  }

  @Post('2fa/disable')
  @HttpCode(204)
  @RequirePermissions()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  disableTotp(@CurrentUser() user: AuthUser, @Body() dto: DisableTotpDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.disableTotp(user, dto.password, dto.code, meta);
  }
}
