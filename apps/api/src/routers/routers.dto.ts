import { OmitType, PartialType } from '@nestjs/mapped-types';
import { ConnectionType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsHost } from '../common/validation/routeros.validators';

export class CreateRouterDto {
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, { message: 'name: letters, digits, _ . - (max 64)' })
  name: string;

  @IsHost() host: string;

  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;

  @IsEnum(ConnectionType) connectionType: ConnectionType = ConnectionType.REST;

  @IsBoolean() useTls = true;

  @IsBoolean() verifyTls = false;

  @IsOptional() @IsInt() @Min(1) @Max(65535) sshPort?: number;

  @IsOptional() @IsUUID() groupId?: string | null;

  @IsOptional() @IsString() @MaxLength(128) location?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @Matches(/^[\w.-]{1,32}$/, { each: true }) tags?: string[];

  @IsString() @IsNotEmpty() @MaxLength(64) username: string;

  @IsString() @IsNotEmpty() @MaxLength(128) password: string;

  /** Verify connectivity & credentials before saving (default true). */
  @IsOptional() @IsBoolean() testConnection?: boolean;
}

export class UpdateRouterDto extends PartialType(OmitType(CreateRouterDto, ['password'] as const)) {
  /** Only sent when rotating the password. */
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(128) password?: string;
}

export class RouterGroupDto {
  @Matches(/^[\p{L}\p{N} _.-]{1,64}$/u) name: string;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
  @IsOptional() @IsUUID() parentId?: string | null;
}

export class UpdateRouterGroupDto extends PartialType(RouterGroupDto) {}
