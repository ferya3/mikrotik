import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { PASSWORD_POLICY, PASSWORD_POLICY_MSG } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth/decorators';
import { PERMISSIONS } from '../common/rbac/permissions';
import { PrismaService } from '../prisma/prisma.service';

class CreateUserDto {
  @Matches(/^[a-z0-9_.-]{3,32}$/, { message: 'username: 3-32 chars, lowercase letters, digits, _ . -' })
  username: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(128) fullName?: string;
  @Matches(PASSWORD_POLICY, { message: PASSWORD_POLICY_MSG }) password: string;
  @IsUUID() roleId: string;
}

class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Clears a user's 2FA (lost device). */
  @IsOptional() @IsBoolean() resetTotp?: boolean;
}

const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  fullName: true,
  isActive: true,
  totpEnabled: true,
  lockedUntil: true,
  lastLoginAt: true,
  lastLoginIp: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  list() {
    return this.prisma.user.findMany({ select: USER_SELECT, orderBy: { username: 'asc' } });
  }

  roles() {
    return this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
    });
  }

  async create(dto: CreateUserDto, actor: AuthUser, meta: RequestMeta) {
    const { password, ...rest } = dto;
    return this.audit.track(
      { action: 'USER_CREATE', user: actor, meta, targetType: 'user', after: rest, targetIdFrom: (u: { id: string }) => u.id },
      async () =>
        this.prisma.user.create({
          data: { ...rest, passwordHash: await AuthService.hashPassword(password) },
          select: USER_SELECT,
        }),
    );
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser, meta: RequestMeta) {
    const before = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!before) throw new NotFoundException('User not found');
    if (id === actor.id && (dto.isActive === false || (dto.roleId && dto.roleId !== before.role.id))) {
      throw new BadRequestException('You cannot deactivate yourself or change your own role');
    }
    if (before.role.name === 'super_admin' && (dto.isActive === false || dto.roleId)) {
      await this.assertNotLastSuperAdmin(id);
    }
    const { password, resetTotp, ...rest } = dto;
    const updated = await this.audit.track(
      {
        action: 'USER_UPDATE',
        user: actor,
        meta,
        targetType: 'user',
        targetId: id,
        before,
        after: { ...rest, ...(password ? { password: '(changed)' } : {}), ...(resetTotp ? { resetTotp } : {}) },
      },
      async () =>
        this.prisma.user.update({
          where: { id },
          data: {
            ...rest,
            ...(password ? { passwordHash: await AuthService.hashPassword(password), failedLogins: 0, lockedUntil: null } : {}),
            ...(resetTotp ? { totpEnabled: false, totpSecretEnc: null } : {}),
          },
          select: USER_SELECT,
        }),
    );
    // Any security-relevant change ends the user's existing sessions.
    if (password || rest.roleId || rest.isActive === false || resetTotp) await this.sessions.revokeAllForUser(id);
    return updated;
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    if (id === actor.id) throw new BadRequestException('You cannot delete yourself');
    const before = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!before) throw new NotFoundException('User not found');
    if (before.role.name === 'super_admin') await this.assertNotLastSuperAdmin(id);
    await this.audit.track({ action: 'USER_DELETE', user: actor, meta, targetType: 'user', targetId: id, before }, () =>
      this.prisma.user.delete({ where: { id } }),
    );
  }

  private async assertNotLastSuperAdmin(excludingId: string) {
    const others = await this.prisma.user.count({
      where: { id: { not: excludingId }, isActive: true, role: { name: 'super_admin' } },
    });
    if (others === 0) throw new BadRequestException('At least one active super admin must remain');
  }
}

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @RequirePermissions(PERMISSIONS.USER_READ)
  list() {
    return this.users.list();
  }

  @Post('users')
  @RequirePermissions(PERMISSIONS.USER_WRITE)
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.users.create(dto, user, meta);
  }

  @Patch('users/:id')
  @RequirePermissions(PERMISSIONS.USER_WRITE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.users.update(id, dto, user, meta);
  }

  @Delete('users/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.USER_WRITE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.users.remove(id, user, meta);
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.USER_READ)
  roles() {
    return this.users.roles();
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
