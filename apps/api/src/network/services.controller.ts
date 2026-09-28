import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth/decorators';
import { RosIdPipe } from '../common/pipes/ros-id.pipe';
import { PERMISSIONS as P } from '../common/rbac/permissions';
import {
  CreateDhcpLeaseDto,
  CreatePppSecretDto,
  CreateSimpleQueueDto,
  LogQueryDto,
  UpdateDhcpLeaseDto,
  UpdatePppSecretDto,
  UpdateSimpleQueueDto,
} from './network.dto';
import { NetworkService } from './network.service';
import { RESOURCES } from './resources';

@Controller('routers/:routerId/dhcp')
export class DhcpController {
  constructor(private readonly net: NetworkService) {}

  @Get('servers')
  @RequirePermissions(P.DHCP_READ)
  servers(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.net.list(routerId, RESOURCES.dhcpServer);
  }

  @Get('networks')
  @RequirePermissions(P.DHCP_READ)
  networks(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.net.list(routerId, RESOURCES.dhcpNetwork);
  }

  @Get('leases')
  @RequirePermissions(P.DHCP_READ)
  leases(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.net.list(routerId, RESOURCES.dhcpLease);
  }

  /** Creates a static lease (IP ↔ MAC reservation). */
  @Post('leases')
  @RequirePermissions(P.DHCP_WRITE)
  createLease(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: CreateDhcpLeaseDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.create(routerId, RESOURCES.dhcpLease, dto, { user, meta });
  }

  @Patch('leases/:id')
  @RequirePermissions(P.DHCP_WRITE)
  updateLease(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @Body() dto: UpdateDhcpLeaseDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.update(routerId, RESOURCES.dhcpLease, id, dto, { user, meta });
  }

  @Post('leases/:id/make-static')
  @HttpCode(204)
  @RequirePermissions(P.DHCP_WRITE)
  makeStatic(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.makeStaticLease(routerId, RESOURCES.dhcpLease, id, { user, meta });
  }

  @Delete('leases/:id')
  @HttpCode(204)
  @RequirePermissions(P.DHCP_WRITE)
  removeLease(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.remove(routerId, RESOURCES.dhcpLease, id, { user, meta });
  }
}

@Controller('routers/:routerId/ppp')
export class PppController {
  constructor(private readonly net: NetworkService) {}

  @Get('secrets')
  @RequirePermissions(P.PPP_READ)
  secrets(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.net.list(routerId, RESOURCES.pppSecret);
  }

  @Post('secrets')
  @RequirePermissions(P.PPP_WRITE)
  createSecret(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: CreatePppSecretDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.create(routerId, RESOURCES.pppSecret, dto, { user, meta });
  }

  @Patch('secrets/:id')
  @RequirePermissions(P.PPP_WRITE)
  updateSecret(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @Body() dto: UpdatePppSecretDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.update(routerId, RESOURCES.pppSecret, id, dto, { user, meta });
  }

  @Delete('secrets/:id')
  @HttpCode(204)
  @RequirePermissions(P.PPP_WRITE)
  removeSecret(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.remove(routerId, RESOURCES.pppSecret, id, { user, meta });
  }

  @Get('profiles')
  @RequirePermissions(P.PPP_READ)
  profiles(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.net.list(routerId, RESOURCES.pppProfile);
  }

  @Get('active')
  @RequirePermissions(P.PPP_READ)
  active(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.net.list(routerId, RESOURCES.pppActive);
  }

  /** Disconnects an active PPP session (the client may redial). */
  @Delete('active/:id')
  @HttpCode(204)
  @RequirePermissions(P.PPP_WRITE)
  disconnect(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.remove(routerId, RESOURCES.pppActive, id, { user, meta });
  }
}

@Controller('routers/:routerId/queues/simple')
export class QueuesController {
  constructor(private readonly net: NetworkService) {}

  @Get()
  @RequirePermissions(P.QUEUE_READ)
  list(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.net.list(routerId, RESOURCES.simpleQueue);
  }

  @Post()
  @RequirePermissions(P.QUEUE_WRITE)
  create(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body() dto: CreateSimpleQueueDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.create(routerId, RESOURCES.simpleQueue, dto, { user, meta });
  }

  @Patch(':id')
  @RequirePermissions(P.QUEUE_WRITE)
  update(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @Body() dto: UpdateSimpleQueueDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.update(routerId, RESOURCES.simpleQueue, id, dto, { user, meta });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.QUEUE_WRITE)
  remove(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', RosIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.net.remove(routerId, RESOURCES.simpleQueue, id, { user, meta });
  }
}

@Controller('routers/:routerId/system')
export class SystemController {
  constructor(private readonly net: NetworkService) {}

  /** Live identity, resources, routerboard and temperature. */
  @Get()
  @RequirePermissions(P.ROUTER_READ)
  system(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.net.system(routerId);
  }

  @Get('logs')
  @RequirePermissions(P.LOG_READ)
  logs(@Param('routerId', ParseUUIDPipe) routerId: string, @Query() q: LogQueryDto) {
    return this.net.logs(routerId, q.limit, q.topic);
  }

  @Post('reboot')
  @HttpCode(202)
  @RequirePermissions(P.SYSTEM_REBOOT)
  reboot(@Param('routerId', ParseUUIDPipe) routerId: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.net.reboot(routerId, { user, meta });
  }
}
