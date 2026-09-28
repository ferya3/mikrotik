import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AlertSeverity, RouterStatus } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config/env';
import { RouterAuthError } from '../mikrotik/errors';
import { MikrotikService } from '../mikrotik/mikrotik.service';
import { parseRosDuration } from '../mikrotik/routeros.client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { AlertsService, EVENTS_CHANNEL } from './alerts.service';

export interface InterfaceLive {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  rxBps: number;
  txBps: number;
}

export interface RouterLive {
  routerId: string;
  status: RouterStatus;
  ts: number;
  error?: string;
  cpuLoad?: number;
  memUsed?: number;
  memTotal?: number;
  uptime?: string;
  temperature?: number | null;
  rxBps?: number;
  txBps?: number;
  pppActive?: number;
  interfaces?: InterfaceLive[];
}

export const liveKey = (routerId: string) => `nms:live:${routerId}`;

/** Physical ports: counted in router throughput and watched for link-down alerts. */
const PHYSICAL = /^(ether|sfp|sfp-sfpplus|sfp28|qsfpplus|qsfp28|combo|wlan|wifi|lte|5g)/;
const CPU_SUSTAIN_POLLS = 3;

interface Counters {
  ts: number;
  bytes: Map<string, { rx: number; tx: number }>;
  running: Map<string, boolean>;
  cpuHigh: number;
  cpuChecked: boolean;
}

/**
 * Polls every router on an interval, stores the live snapshot in Redis, publishes it for
 * the WebSocket gateway, persists a short history sample and drives alerts.
 * A Redis lock ensures only one API replica polls at a time.
 */
@Injectable()
export class PollerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PollerService.name);
  private readonly state = new Map<string, Counters>();
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mikrotik: MikrotikService,
    private readonly redis: RedisService,
    private readonly alerts: AlertsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap() {
    if (process.env.DISABLE_POLLER === 'true') return;
    this.timers.push(setInterval(() => void this.tick(), this.config.pollIntervalMs));
    this.timers.push(setInterval(() => void this.cleanup(), 3600_000));
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    if (!(await this.redis.tryLock('poller', Math.max(this.config.pollIntervalMs - 500, 1000)))) return;
    this.running = true;
    try {
      const routers = await this.prisma.router.findMany({
        select: { id: true, name: true, host: true, status: true },
      });
      let idx = 0;
      const worker = async () => {
        while (idx < routers.length) await this.pollOne(routers[idx++]);
      };
      await Promise.all(Array.from({ length: Math.min(this.config.pollConcurrency, routers.length) }, worker));
    } catch (e) {
      this.logger.error(`Poll cycle failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async pollOne(r: { id: string; name: string; host: string; status: RouterStatus }): Promise<RouterLive> {
    const now = Date.now();
    let live: RouterLive;
    try {
      live = await this.mikrotik.withClient(r.id, async (c) => {
        const [res, ifaces, temperature, ppp] = await Promise.all([
          c.getSystemResource(),
          c.listInterfaces(),
          c.getTemperature(),
          c.adapter.print('/ppp/active', { proplist: ['.id'] }).catch(() => []),
        ]);
        return this.buildLive(r.id, now, res, ifaces, temperature, ppp.length);
      });
    } catch (e) {
      const status = e instanceof RouterAuthError ? RouterStatus.AUTH_FAILED : RouterStatus.OFFLINE;
      live = { routerId: r.id, status, ts: now, error: (e as Error).message };
    }

    await this.persist(r, live);
    await this.evaluateAlerts(r, live);
    return live;
  }

  private buildLive(
    routerId: string,
    now: number,
    res: Awaited<ReturnType<import('../mikrotik/routeros.client').RouterOsClient['getSystemResource']>>,
    ifaces: Record<string, string>[],
    temperature: number | null,
    pppActive: number,
  ): RouterLive {
    const prev = this.state.get(routerId);
    const dt = prev ? (now - prev.ts) / 1000 : 0;
    const usable = prev && dt > 0 && dt < (this.config.pollIntervalMs / 1000) * 3;
    const bytes = new Map<string, { rx: number; tx: number }>();
    let rxBps = 0;
    let txBps = 0;

    const interfaces: InterfaceLive[] = ifaces.map((i) => {
      const rx = Number(i['rx-byte'] ?? 0);
      const tx = Number(i['tx-byte'] ?? 0);
      bytes.set(i.name, { rx, tx });
      const p = usable ? prev.bytes.get(i.name) : undefined;
      // Counter reset (reboot / wrap) → negative delta → treat as 0.
      const irx = p ? Math.max(0, ((rx - p.rx) * 8) / dt) : 0;
      const itx = p ? Math.max(0, ((tx - p.tx) * 8) / dt) : 0;
      if (PHYSICAL.test(i.type ?? '')) {
        rxBps += irx;
        txBps += itx;
      }
      return {
        name: i.name,
        type: i.type,
        running: i.running === 'true',
        disabled: i.disabled === 'true',
        rxBps: Math.round(irx),
        txBps: Math.round(itx),
      };
    });

    this.state.set(routerId, {
      ts: now,
      bytes,
      running: prev?.running ?? new Map(),
      cpuHigh: prev?.cpuHigh ?? 0,
      cpuChecked: prev?.cpuChecked ?? false,
    });

    return {
      routerId,
      status: RouterStatus.ONLINE,
      ts: now,
      cpuLoad: res.cpuLoad,
      memUsed: res.totalMemory - res.freeMemory,
      memTotal: res.totalMemory,
      uptime: res.uptime,
      temperature,
      rxBps: Math.round(rxBps),
      txBps: Math.round(txBps),
      pppActive,
      interfaces,
    };
  }

  private async persist(r: { id: string; status: RouterStatus }, live: RouterLive) {
    const ttlSec = Math.ceil((this.config.pollIntervalMs * 5) / 1000);
    await this.redis.client.set(liveKey(r.id), JSON.stringify(live), 'EX', ttlSec);
    await this.redis.client.publish(EVENTS_CHANNEL, JSON.stringify({ event: 'router.live', data: live }));

    if (live.status === RouterStatus.ONLINE) {
      await this.prisma.router.update({ where: { id: r.id }, data: { status: live.status, lastSeenAt: new Date(live.ts) } });
      await this.prisma.metricSample.create({
        data: {
          routerId: r.id,
          cpuLoad: live.cpuLoad,
          memUsed: live.memUsed !== undefined ? BigInt(live.memUsed) : undefined,
          memTotal: live.memTotal !== undefined ? BigInt(live.memTotal) : undefined,
          uptimeSec: parseRosDuration(live.uptime),
          temperature: live.temperature ?? undefined,
          rxBps: BigInt(live.rxBps ?? 0),
          txBps: BigInt(live.txBps ?? 0),
        },
      });
    } else if (r.status !== live.status) {
      await this.prisma.router.update({ where: { id: r.id }, data: { status: live.status } });
    }
  }

  private async evaluateAlerts(r: { id: string; name: string; host: string; status: RouterStatus }, live: RouterLive) {
    const base = { routerId: r.id, routerName: r.name, host: r.host };

    if (live.status === RouterStatus.OFFLINE) {
      const lastSeen = await this.prisma.router.findUnique({ where: { id: r.id }, select: { lastSeenAt: true } });
      await this.alerts.raise({
        ...base,
        type: 'router.offline',
        severity: AlertSeverity.CRITICAL,
        message: 'Router Offline',
        details: [`Last Seen: ${lastSeen?.lastSeenAt?.toISOString() ?? 'never'}`, `Error: ${live.error}`],
      });
      return;
    }
    if (live.status === RouterStatus.AUTH_FAILED) {
      await this.alerts.raise({
        ...base,
        type: 'router.auth',
        severity: AlertSeverity.CRITICAL,
        message: 'Router rejected credentials',
      });
      return;
    }

    // Only touch the alert table on transitions, not on every poll.
    if (r.status !== RouterStatus.ONLINE) {
      await this.alerts.resolve(r.id, 'router.offline', undefined, { routerName: r.name, message: 'Router back online' });
      await this.alerts.resolve(r.id, 'router.auth', undefined, { routerName: r.name, message: 'Router login restored' });
    }

    const st = this.state.get(r.id)!;
    // CPU: alert only when sustained, to avoid flapping on short spikes.
    const wasHigh = st.cpuHigh;
    st.cpuHigh = (live.cpuLoad ?? 0) >= this.config.cpuAlertThreshold ? st.cpuHigh + 1 : 0;
    if (st.cpuHigh === CPU_SUSTAIN_POLLS) {
      await this.alerts.raise({
        ...base,
        type: 'cpu.high',
        severity: AlertSeverity.WARNING,
        message: `High CPU load (${live.cpuLoad}%)`,
      });
    } else if (st.cpuHigh === 0 && (wasHigh >= CPU_SUSTAIN_POLLS || !st.cpuChecked)) {
      await this.alerts.resolve(r.id, 'cpu.high', undefined, { routerName: r.name, message: 'CPU load back to normal' });
    }
    st.cpuChecked = true;

    // Link state: alert on running → not running for enabled physical ports.
    for (const i of live.interfaces ?? []) {
      if (!PHYSICAL.test(i.type ?? '')) continue;
      const was = st.running.get(i.name);
      st.running.set(i.name, i.running);
      if (i.disabled) continue;
      if (was === true && !i.running) {
        await this.alerts.raise({
          ...base,
          type: 'interface.down',
          subject: i.name,
          severity: AlertSeverity.CRITICAL,
          message: `Interface ${i.name} down`,
        });
      } else if (i.running && was !== true) {
        // Came back up (or first observation after a restart, in case an alert was left open).
        await this.alerts.resolve(r.id, 'interface.down', i.name, {
          routerName: r.name,
          message: `Interface ${i.name} up`,
        });
      }
    }
  }

  private async cleanup() {
    if (!(await this.redis.tryLock('metrics-cleanup', 600_000))) return;
    const cutoff = new Date(Date.now() - this.config.metricsRetentionHours * 3600_000);
    const { count } = await this.prisma.metricSample.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count) this.logger.log(`Pruned ${count} metric samples older than ${cutoff.toISOString()}`);
  }
}
