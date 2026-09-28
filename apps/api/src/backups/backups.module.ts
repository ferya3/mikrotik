import { BullModule } from '@nestjs/bullmq';
import { Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth/decorators';
import { PERMISSIONS } from '../common/rbac/permissions';
import { BackupsProcessor } from './backups.processor';
import { BACKUP_QUEUE, BackupsService } from './backups.service';

@Controller()
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get('routers/:routerId/backups')
  @RequirePermissions(PERMISSIONS.BACKUP_READ)
  list(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.backups.list(routerId);
  }

  @Post('routers/:routerId/backups')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.BACKUP_CREATE)
  create(@Param('routerId', ParseUUIDPipe) routerId: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.backups.request(routerId, user, meta);
  }

  @Post('backups/run-all')
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.BACKUP_CREATE)
  runAll(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.backups.requestAll(user, meta);
  }

  @Get('backups/:id')
  @RequirePermissions(PERMISSIONS.BACKUP_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.backups.get(id);
  }

  /** ?from=<backupId> — defaults to the previous successful backup. */
  @Get('backups/:id/diff')
  @RequirePermissions(PERMISSIONS.BACKUP_READ)
  diff(@Param('id', ParseUUIDPipe) id: string, @Query('from', new ParseUUIDPipe({ optional: true })) from?: string) {
    return this.backups.diff(id, from);
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: BACKUP_QUEUE })],
  controllers: [BackupsController],
  providers: [BackupsService, BackupsProcessor],
})
export class BackupsModule {}
