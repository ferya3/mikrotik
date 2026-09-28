import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RosRecord } from '../mikrotik/types';
import { usageCounters, usageDeltas, UsageCounter } from './client-model';

/** UTC calendar day as a Date at 00:00Z (matches the @db.Date column). */
export function utcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Accumulates per-client traffic into client_usage_daily. Fed by the poller on every cycle;
 * works from byte-counter deltas so it survives reboots and PPP reconnects.
 */
@Injectable()
export class ClientUsageService {
  private readonly logger = new Logger(ClientUsageService.name);
  private readonly prev = new Map<string, Map<string, UsageCounter>>();

  constructor(private readonly prisma: PrismaService) {}

  async ingest(routerId: string, queues: RosRecord[], pppActive: RosRecord[], interfaces: RosRecord[]): Promise<void> {
    const current = usageCounters(queues, pppActive, interfaces);
    const deltas = usageDeltas(this.prev.get(routerId), current);
    this.prev.set(routerId, current);
    if (!deltas.size) return;

    const day = utcDay();
    try {
      await this.prisma.$transaction(
        [...deltas].map(([clientKey, d]) =>
          this.prisma.clientUsageDaily.upsert({
            where: { routerId_clientKey_day: { routerId, clientKey, day } },
            create: { routerId, clientKey, day, downloadBytes: BigInt(d.down), uploadBytes: BigInt(d.up), label: d.label },
            update: {
              downloadBytes: { increment: BigInt(d.down) },
              uploadBytes: { increment: BigInt(d.up) },
              ...(d.label ? { label: d.label } : {}),
            },
          }),
        ),
      );
    } catch (e) {
      this.logger.warn(`Usage accounting failed for ${routerId}: ${(e as Error).message}`);
    }
  }

  /** Totals per client over the last `days` days (including today), heaviest downloaders first. */
  async totals(routerId: string, days: number) {
    const since = utcDay(new Date(Date.now() - (days - 1) * 86_400_000));
    const rows = await this.prisma.clientUsageDaily.groupBy({
      by: ['clientKey'],
      where: { routerId, day: { gte: since } },
      _sum: { downloadBytes: true, uploadBytes: true },
      _max: { label: true },
      orderBy: { _sum: { downloadBytes: 'desc' } },
      take: 200,
    });
    return rows.map((r) => ({
      key: r.clientKey,
      label: r._max.label,
      downloadBytes: Number(r._sum.downloadBytes ?? 0),
      uploadBytes: Number(r._sum.uploadBytes ?? 0),
    }));
  }

  async today(routerId: string): Promise<Map<string, { down: number; up: number }>> {
    const rows = await this.prisma.clientUsageDaily.findMany({ where: { routerId, day: utcDay() } });
    return new Map(rows.map((r) => [r.clientKey, { down: Number(r.downloadBytes), up: Number(r.uploadBytes) }]));
  }

  async history(routerId: string, clientKey: string, days: number) {
    const since = utcDay(new Date(Date.now() - (days - 1) * 86_400_000));
    const rows = await this.prisma.clientUsageDaily.findMany({
      where: { routerId, clientKey, day: { gte: since } },
      orderBy: { day: 'asc' },
    });
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      downloadBytes: Number(r.downloadBytes),
      uploadBytes: Number(r.uploadBytes),
    }));
  }
}
