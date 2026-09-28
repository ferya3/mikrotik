import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertSeverity, AlertState } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { NotificationService } from './notification.service';

export const EVENTS_CHANNEL = 'nms:events';

export interface RaiseAlert {
  routerId: string;
  routerName: string;
  host: string;
  type: string;
  severity: AlertSeverity;
  message: string;
  /** Distinguishes several alerts of one type on a router, e.g. the interface name. */
  subject?: string;
  details?: string[];
}

/**
 * Alert lifecycle with de-duplication: one OPEN/ACKNOWLEDGED alert per fingerprint.
 * A notification is sent when an alert opens and when it resolves, never on every poll.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  static fingerprint(routerId: string, type: string, subject = '') {
    return `${routerId}:${type}:${subject}`;
  }

  async raise(a: RaiseAlert): Promise<void> {
    const fingerprint = AlertsService.fingerprint(a.routerId, a.type, a.subject);
    const existing = await this.prisma.alert.findFirst({
      where: { fingerprint, state: { in: [AlertState.OPEN, AlertState.ACKNOWLEDGED] } },
    });
    if (existing) return;
    const alert = await this.prisma.alert.create({
      data: { routerId: a.routerId, type: a.type, severity: a.severity, message: a.message, fingerprint },
    });
    await this.redis.client.publish(EVENTS_CHANNEL, JSON.stringify({ event: 'alert.opened', alert }));
    await this.notify.send({
      severity: a.severity,
      title: a.message,
      lines: [`Router: ${a.routerName}`, `IP: ${a.host}`, `Time: ${alert.createdAt.toISOString()}`, ...(a.details ?? [])],
    });
  }

  async resolve(routerId: string, type: string, subject: string | undefined, info: { routerName: string; message: string }) {
    const fingerprint = AlertsService.fingerprint(routerId, type, subject);
    const open = await this.prisma.alert.findFirst({
      where: { fingerprint, state: { in: [AlertState.OPEN, AlertState.ACKNOWLEDGED] } },
    });
    if (!open) return;
    const resolvedAt = new Date();
    await this.prisma.alert.update({ where: { id: open.id }, data: { state: AlertState.RESOLVED, resolvedAt } });
    await this.redis.client.publish(EVENTS_CHANNEL, JSON.stringify({ event: 'alert.resolved', id: open.id }));
    const downSec = Math.round((resolvedAt.getTime() - open.createdAt.getTime()) / 1000);
    await this.notify.send({
      severity: AlertSeverity.INFO,
      title: info.message,
      lines: [`Router: ${info.routerName}`, `Duration: ${formatDuration(downSec)}`],
    });
  }

  list(state?: AlertState, take = 100) {
    return this.prisma.alert.findMany({
      where: state ? { state } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      include: { router: { select: { id: true, name: true, host: true } } },
    });
  }

  async acknowledge(id: string, user: AuthUser, meta: RequestMeta) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found');
    if (alert.state !== AlertState.OPEN) return alert;
    return this.audit.track(
      { action: 'ALERT_ACK', user, meta, routerId: alert.routerId, targetType: 'alert', targetId: id },
      () =>
        this.prisma.alert.update({
          where: { id },
          data: { state: AlertState.ACKNOWLEDGED, acknowledgedBy: user.id },
        }),
    );
  }
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : '', `${s}s`].filter(Boolean).join(' ');
}
