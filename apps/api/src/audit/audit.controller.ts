import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { RequirePermissions } from '../common/auth/decorators';
import { PERMISSIONS } from '../common/rbac/permissions';
import { AuditService } from './audit.service';

class AuditQuery {
  @IsOptional() @IsUUID() routerId?: string;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) take = 50;
}

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  list(@Query() q: AuditQuery) {
    return this.audit.list(q);
  }
}
