import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  AuthUser,
  CurrentUser,
  ReqMeta,
  RequestMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/auth/decorators';
import { RosIdPipe } from '../common/pipes/ros-id.pipe';
import { PERMISSIONS as P } from '../common/rbac/permissions';
import { IsRosName } from '../common/validation/routeros.validators';
import { IsOptional } from 'class-validator';
import {
  CreateAddressListEntryDto,
  CreateFilterRuleDto,
  CreateNatRuleDto,
  MoveRuleDto,
  UpdateAddressListEntryDto,
  UpdateFilterRuleDto,
  UpdateNatRuleDto,
} from './network.dto';
import { NetworkService } from './network.service';
import { RESOURCES } from './resources';

class AddressListQuery {
  @IsOptional() @IsRosName() list?: string;
}

/**
 * Structured firewall API. Clients describe *what* they want (chain, action, matchers);
 * the backend builds the RouterOS request — there is deliberately no raw-command endpoint.
 */
@Controller('routers/:routerId/firewall')
export class FirewallController {
  constructor(private readonly net: NetworkService) {}

  // ── Filter rules ──────────────────────────────────────
  @Get('filter')
  @RequirePermissions(P.FIREWALL_READ)
  listFilter(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.net.list(routerId, RESOURCES.firewallFilter);
  }

  @Post('filter')
  @RequirePermissions(P.FIREWALL_WRITE)
  createFilter(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: CreateFilterRuleDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.create(routerId, RESOURCES.firewallFilter, dto, { user, meta });
  }

  @Patch('filter/:id')
  @RequirePermissions(P.FIREWALL_WRITE)
  updateFilter(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @Body() dto: UpdateFilterRuleDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.update(routerId, RESOURCES.firewallFilter, id, dto, { user, meta });
  }

  @Delete('filter/:id')
  @HttpCode(204)
  @RequirePermissions(P.FIREWALL_WRITE)
  removeFilter(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.remove(routerId, RESOURCES.firewallFilter, id, { user, meta });
  }

  @Post('filter/:id/move')
  @HttpCode(204)
  @RequirePermissions(P.FIREWALL_WRITE)
  moveFilter(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @Body() dto: MoveRuleDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.move(routerId, RESOURCES.firewallFilter, id, dto.before, { user, meta });
  }

  // ── NAT ───────────────────────────────────────────────
  @Get('nat')
  @RequirePermissions(P.FIREWALL_READ)
  listNat(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.net.list(routerId, RESOURCES.firewallNat);
  }

  @Post('nat')
  @RequirePermissions(P.FIREWALL_WRITE)
  createNat(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: CreateNatRuleDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.create(routerId, RESOURCES.firewallNat, dto, { user, meta });
  }

  @Patch('nat/:id')
  @RequirePermissions(P.FIREWALL_WRITE)
  updateNat(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @Body() dto: UpdateNatRuleDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.update(routerId, RESOURCES.firewallNat, id, dto, { user, meta });
  }

  @Delete('nat/:id')
  @HttpCode(204)
  @RequirePermissions(P.FIREWALL_WRITE)
  removeNat(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.remove(routerId, RESOURCES.firewallNat, id, { user, meta });
  }

  @Post('nat/:id/move')
  @HttpCode(204)
  @RequirePermissions(P.FIREWALL_WRITE)
  moveNat(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @Body() dto: MoveRuleDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.move(routerId, RESOURCES.firewallNat, id, dto.before, { user, meta });
  }

  // ── Address lists (Operators may manage these) ────────
  @Get('address-list')
  @RequirePermissions(P.FIREWALL_READ)
  listAddressList(@Param('routerId', ParseUUIDPipe) routerId: string, @Query() q: AddressListQuery) {
    return this.net.list(routerId, RESOURCES.addressList, q.list ? { list: q.list } : undefined);
  }

  @Post('address-list')
  @RequireAnyPermission(P.FIREWALL_WRITE, P.FIREWALL_ADDRESS_LIST)
  createAddressList(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: CreateAddressListEntryDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.create(routerId, RESOURCES.addressList, dto, { user, meta });
  }

  @Patch('address-list/:id')
  @RequireAnyPermission(P.FIREWALL_WRITE, P.FIREWALL_ADDRESS_LIST)
  updateAddressList(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @Body() dto: UpdateAddressListEntryDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.update(routerId, RESOURCES.addressList, id, dto, { user, meta });
  }

  @Delete('address-list/:id')
  @HttpCode(204)
  @RequireAnyPermission(P.FIREWALL_WRITE, P.FIREWALL_ADDRESS_LIST)
  removeAddressList(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.remove(routerId, RESOURCES.addressList, id, { user, meta });
  }
}
