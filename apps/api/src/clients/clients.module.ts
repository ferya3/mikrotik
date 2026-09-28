import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsIP,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth/decorators';
import { PERMISSIONS as P } from '../common/rbac/permissions';
import { IsRosComment, IsRosDuration } from '../common/validation/routeros.validators';
import { ClientUsageService } from './client-usage.service';
import { ClientsService } from './clients.service';

const PPP_USER = /^[\w.@-]{1,64}$/;
/** 512k, 10M, 1G … */
const RATE = /^\d+(\.\d+)?[kKMG]?$/;

/** Exactly one of address (DHCP/hotspot/static clients) or pppUser (PPP sessions). */
class ClientRefDto {
  @ValidateIf((o) => !o.pppUser) @IsIP() address?: string;
  @ValidateIf((o) => !o.address) @Matches(PPP_USER) pppUser?: string;
}

class LimitDto extends ClientRefDto {
  @Matches(RATE, { message: 'download must look like 512k, 10M or 1G' }) download: string;
  @Matches(RATE, { message: 'upload must look like 512k, 10M or 1G' }) upload: string;
  @IsOptional() @IsRosComment() comment?: string;
  /** PPP only: disconnect the session so the new limit applies immediately. */
  @IsOptional() @IsBoolean() reconnect?: boolean;
}

class UnlimitDto extends ClientRefDto {
  @IsOptional() @IsBoolean() reconnect?: boolean;
}

class BlockDto extends ClientRefDto {
  @IsOptional() @IsRosComment() reason?: string;
  /** e.g. 1h, 1d — the block expires automatically (IP clients). Empty = until unblocked. */
  @IsOptional() @IsRosDuration() duration?: string;
}

class TrackDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsIP(undefined, { each: true }) addresses: string[];
}

class DaysQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(366) days = 30;
}

class HistoryQuery extends DaysQuery {
  @Matches(/^(ip:[0-9a-fA-F.:]{2,45}|ppp:[\w.@-]{1,64})$/) key: string;
}

@Controller('routers/:routerId/clients')
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly usage: ClientUsageService,
  ) {}

  /** Everyone connected (DHCP, PPP, hotspot, static) with live rate, today's usage, limit and block state. */
  @Get()
  @RequirePermissions(P.CLIENT_READ)
  list(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.clients.list(routerId);
  }

  /** Usage totals per client over the last N days, heaviest first. */
  @Get('usage')
  @RequirePermissions(P.CLIENT_READ)
  totals(@Param('routerId', ParseUUIDPipe) routerId: string, @Query() q: DaysQuery) {
    return this.usage.totals(routerId, q.days);
  }

  /** Daily usage of one client (?key=ip:192.168.88.10 or ppp:ali). */
  @Get('usage/history')
  @RequirePermissions(P.CLIENT_READ)
  history(@Param('routerId', ParseUUIDPipe) routerId: string, @Query() q: HistoryQuery) {
    return this.usage.history(routerId, q.key, q.days);
  }

  @Post('limit')
  @HttpCode(200)
  @RequirePermissions(P.CLIENT_WRITE)
  limit(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: LimitDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clients.limit(routerId, dto, dto, { user, meta });
  }

  @Post('unlimit')
  @HttpCode(200)
  @RequirePermissions(P.CLIENT_WRITE)
  unlimit(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: UnlimitDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clients.unlimit(routerId, dto, !!dto.reconnect, { user, meta });
  }

  @Post('block')
  @HttpCode(200)
  @RequirePermissions(P.CLIENT_WRITE)
  block(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: BlockDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clients.block(routerId, dto, dto, { user, meta });
  }

  @Post('unblock')
  @HttpCode(200)
  @RequirePermissions(P.CLIENT_WRITE)
  unblock(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: ClientRefDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clients.unblock(routerId, dto, { user, meta });
  }

  /** Start counting usage for IP clients (creates an unlimited nms-<ip> queue each). */
  @Post('track')
  @HttpCode(200)
  @RequirePermissions(P.CLIENT_WRITE)
  track(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: TrackDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clients.track(routerId, dto.addresses, { user, meta });
  }
}

@Module({
  controllers: [ClientsController],
  providers: [ClientsService, ClientUsageService],
  exports: [ClientUsageService],
})
export class ClientsModule {}
