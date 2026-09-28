import {
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { AlertState, RouterStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { timingSafeEqual } from 'crypto';
import { AuthUser, CurrentUser, Public, ReqMeta, RequestMeta, RequirePermissions } from '../common/auth/decorators';
import { PERMISSIONS } from '../common/rbac/permissions';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { AlertsService } from './alerts.service';
import { liveKey, RouterLive } from './live';

class HistoryQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(168) hours = 1;
}

class AlertQuery {
  @IsOptional() @IsEnum(AlertState) state?: AlertState;
}

@Controller()
export class MonitoringController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly alerts: AlertsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Dashboard summary: every router with its latest live snapshot (from Redis, no router round-trip). */
  @Get('monitoring/overview')
  @RequirePermissions(PERMISSIONS.MONITORING_READ)
  async overview() {
    const routers = await this.prisma.router.findMany({
      select: { id: true, name: true, host: true, status: true, lastSeenAt: true, version: true, group: true },
      orderBy: { name: 'asc' },
    });
    const live = await this.liveFor(routers.map((r) => r.id));
    const online = routers.filter((r) => r.status === RouterStatus.ONLINE).length;
    const cpus = live.filter((l): l is RouterLive => !!l && l.cpuLoad !== undefined).map((l) => l.cpuLoad!);
    const openAlerts = await this.prisma.alert.count({ where: { state: AlertState.OPEN } });
    return {
      totals: {
        routers: routers.length,
        online,
        offline: routers.length - online,
        avgCpu: cpus.length ? Math.round(cpus.reduce((a, b) => a + b, 0) / cpus.length) : null,
        openAlerts,
      },
      routers: routers.map((r, i) => ({ ...r, live: live[i] })),
    };
  }

  @Get('monitoring/routers/:id/live')
  @RequirePermissions(PERMISSIONS.MONITORING_READ)
  async live(@Param('id', ParseUUIDPipe) id: string) {
    const [live] = await this.liveFor([id]);
    return live;
  }

  @Get('monitoring/routers/:id/history')
  @RequirePermissions(PERMISSIONS.MONITORING_READ)
  async history(@Param('id', ParseUUIDPipe) id: string, @Query() q: HistoryQuery) {
    const rows = await this.prisma.metricSample.findMany({
      where: { routerId: id, createdAt: { gte: new Date(Date.now() - q.hours * 3600_000) } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      t: r.createdAt,
      cpu: r.cpuLoad,
      memUsed: r.memUsed !== null ? Number(r.memUsed) : null,
      memTotal: r.memTotal !== null ? Number(r.memTotal) : null,
      temperature: r.temperature,
      rxBps: r.rxBps !== null ? Number(r.rxBps) : null,
      txBps: r.txBps !== null ? Number(r.txBps) : null,
    }));
  }

  @Get('alerts')
  @RequirePermissions(PERMISSIONS.ALERT_READ)
  listAlerts(@Query() q: AlertQuery) {
    return this.alerts.list(q.state);
  }

  @Post('alerts/:id/ack')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ALERT_ACK)
  ack(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.alerts.acknowledge(id, user, meta);
  }

  /**
   * Prometheus exposition of the latest snapshot. Disabled unless METRICS_TOKEN is set;
   * Prometheus must send `Authorization: Bearer <METRICS_TOKEN>`.
   */
  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async metrics(@Headers('authorization') auth?: string) {
    const token = this.config.metricsToken;
    if (!token) throw new NotFoundException();
    const given = Buffer.from(auth?.replace(/^Bearer /, '') ?? '');
    const want = Buffer.from(token);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new UnauthorizedException();

    const routers = await this.prisma.router.findMany({ select: { id: true, name: true } });
    const live = await this.liveFor(routers.map((r) => r.id));
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const lines: string[] = [];
    const metric = (name: string, help: string, type: 'gauge') => lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);

    const series: [string, string, (l: RouterLive) => number | undefined | null][] = [
      ['mikrotik_up', 'Router reachable (1) or not (0)', (l) => (l.status === RouterStatus.ONLINE ? 1 : 0)],
      ['mikrotik_cpu_load_percent', 'CPU load', (l) => l.cpuLoad],
      ['mikrotik_memory_used_bytes', 'Used memory', (l) => l.memUsed],
      ['mikrotik_memory_total_bytes', 'Total memory', (l) => l.memTotal],
      ['mikrotik_temperature_celsius', 'Board temperature', (l) => l.temperature],
      ['mikrotik_rx_bits_per_second', 'Receive throughput on physical ports', (l) => l.rxBps],
      ['mikrotik_tx_bits_per_second', 'Transmit throughput on physical ports', (l) => l.txBps],
      ['mikrotik_ppp_active', 'Active PPP sessions', (l) => l.pppActive],
    ];
    for (const [name, help, get] of series) {
      metric(name, help, 'gauge');
      routers.forEach((r, i) => {
        const l = live[i];
        const v = l ? get(l) : name === 'mikrotik_up' ? 0 : undefined;
        if (v !== undefined && v !== null) lines.push(`${name}{router="${esc(r.name)}",router_id="${r.id}"} ${v}`);
      });
    }
    metric('mikrotik_interface_running', 'Interface link state', 'gauge');
    routers.forEach((r, i) =>
      live[i]?.interfaces?.forEach((f) =>
        lines.push(`mikrotik_interface_running{router="${esc(r.name)}",interface="${esc(f.name)}"} ${f.running ? 1 : 0}`),
      ),
    );
    return lines.join('\n') + '\n';
  }

  private async liveFor(ids: string[]): Promise<(RouterLive | null)[]> {
    if (!ids.length) return [];
    const raw = await this.redis.client.mget(ids.map(liveKey));
    return raw.map((r) => (r ? (JSON.parse(r) as RouterLive) : null));
  }
}
