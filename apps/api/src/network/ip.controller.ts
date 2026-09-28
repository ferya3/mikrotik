import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth/decorators';
import { RosIdPipe } from '../common/pipes/ros-id.pipe';
import { PERMISSIONS as P } from '../common/rbac/permissions';
import {
  CreateIpAddressDto,
  CreateRouteDto,
  UpdateInterfaceDto,
  UpdateIpAddressDto,
  UpdateRouteDto,
} from './network.dto';
import { NetworkService } from './network.service';
import { RESOURCES } from './resources';

@Controller('routers/:routerId/interfaces')
export class InterfacesController {
  constructor(private readonly net: NetworkService) {}

  @Get()
  @RequirePermissions(P.INTERFACE_READ)
  list(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.net.list(routerId, RESOURCES.interface);
  }

  /** comment / mtu / disabled. Renaming is intentionally not offered (it breaks references). */
  @Patch(':id')
  @RequirePermissions(P.INTERFACE_WRITE)
  update(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @Body() dto: UpdateInterfaceDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.update(routerId, RESOURCES.interface, id, dto, { user, meta });
  }
}

@Controller('routers/:routerId/ip/addresses')
export class IpAddressesController {
  constructor(private readonly net: NetworkService) {}

  @Get()
  @RequirePermissions(P.IP_READ)
  list(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.net.list(routerId, RESOURCES.ipAddress);
  }

  @Post()
  @RequirePermissions(P.IP_WRITE)
  create(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: CreateIpAddressDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.create(routerId, RESOURCES.ipAddress, dto, { user, meta });
  }

  @Patch(':id')
  @RequirePermissions(P.IP_WRITE)
  update(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @Body() dto: UpdateIpAddressDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.update(routerId, RESOURCES.ipAddress, id, dto, { user, meta });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.IP_WRITE)
  remove(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.remove(routerId, RESOURCES.ipAddress, id, { user, meta });
  }
}

@Controller('routers/:routerId/ip/routes')
export class RoutesController {
  constructor(private readonly net: NetworkService) {}

  @Get()
  @RequirePermissions(P.IP_READ)
  list(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.net.list(routerId, RESOURCES.route);
  }

  @Post()
  @RequirePermissions(P.IP_WRITE)
  create(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: CreateRouteDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.create(routerId, RESOURCES.route, dto, { user, meta });
  }

  @Patch(':id')
  @RequirePermissions(P.IP_WRITE)
  update(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @Body() dto: UpdateRouteDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.update(routerId, RESOURCES.route, id, dto, { user, meta });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.IP_WRITE)
  remove(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.remove(routerId, RESOURCES.route, id, { user, meta });
  }
}
