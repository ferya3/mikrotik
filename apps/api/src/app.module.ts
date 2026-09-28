import { BullModule } from '@nestjs/bullmq';
import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BackupsModule } from './backups/backups.module';
import { ClientsModule } from './clients/clients.module';
import { Public } from './common/auth/decorators';
import { AuthGuard, CsrfGuard, PermissionsGuard } from './common/auth/guards';
import { CryptoModule } from './common/crypto/crypto.module';
import { PrismaErrorFilter } from './common/filters/prisma-error.filter';
import { RouterErrorFilter } from './common/filters/router-error.filter';
import { ConfigModule } from './config/config.module';
import { loadConfig } from './config/env';
import { MikrotikModule } from './mikrotik/mikrotik.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { NetworkModule } from './network/network.module';
import { PrismaModule, PrismaService } from './prisma/prisma.service';
import { RedisModule } from './redis/redis.module';
import { RoutersModule } from './routers/routers.module';
import { UsersModule } from './users/users.module';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}

function redisConnection() {
  const url = new URL(loadConfig().redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    CryptoModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    BullModule.forRootAsync({ useFactory: () => ({ connection: redisConnection() }) }),
    AuditModule,
    AuthModule,
    UsersModule,
    MikrotikModule,
    RoutersModule,
    NetworkModule,
    ClientsModule,
    MonitoringModule,
    BackupsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate limit → CSRF → authenticate → authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: RouterErrorFilter },
    { provide: APP_FILTER, useClass: PrismaErrorFilter },
  ],
})
export class AppModule {}
