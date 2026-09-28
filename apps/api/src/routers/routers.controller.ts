import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth/decorators';
import { PERMISSIONS } from '../common/rbac/permissions';
import { CreateRouterDto, RouterGroupDto, UpdateRouterDto, UpdateRouterGroupDto } from './routers.dto';
import { RoutersService } from './routers.service';

@Controller('routers')
export class RoutersController {
  constructor(private readonly routers: RoutersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROUTER_READ)
  list(@Query('groupId', new ParseUUIDPipe({ optional: true })) groupId?: string) {
    return this.routers.list(groupId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ROUTER_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.routers.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ROUTER_WRITE)
  create(@Body() dto: CreateRouterDto, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.routers.create(dto, user, meta);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ROUTER_WRITE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRouterDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.routers.update(id, dto, user, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.ROUTER_DELETE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.routers.remove(id, user, meta);
  }

  /** Test connectivity and refresh identity / version / status. */
  @Post(':id/refresh')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ROUTER_READ)
  refresh(@Param('id', ParseUUIDPipe) id: string) {
    return this.routers.refresh(id);
  }

  @Post(':id/ssh-host-key/reset')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.ROUTER_WRITE)
  resetHostKey(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.routers.resetSshHostKey(id, user, meta);
  }
}

@Controller('router-groups')
export class RouterGroupsController {
  constructor(private readonly routers: RoutersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROUTER_READ)
  list() {
    return this.routers.listGroups();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ROUTER_WRITE)
  create(@Body() dto: RouterGroupDto, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.routers.createGroup(dto, user, meta);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ROUTER_WRITE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRouterGroupDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.routers.updateGroup(id, dto, user, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.ROUTER_DELETE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.routers.removeGroup(id, user, meta);
  }
}
