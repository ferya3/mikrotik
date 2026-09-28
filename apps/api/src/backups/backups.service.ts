import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BackupType, JobStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { configDiff } from './config-diff';

export const BACKUP_QUEUE = 'backups';
export const JOB_BACKUP_ROUTER = 'backup-router';
export const JOB_BACKUP_ALL = 'backup-all';

const LIST_SELECT = {
  id: true,
  routerId: true,
  type: true,
  status: true,
  sha256: true,
  sizeBytes: true,
  error: true,
  createdAt: true,
  finishedAt: true,
  createdBy: { select: { username: true } },
} as const;

/**
 * Backups never run inside the HTTP request: the API enqueues a job and returns immediately,
 * a BullMQ worker talks to the routers.
 */
@Injectable()
export class BackupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectQueue(BACKUP_QUEUE) private readonly queue: Queue,
  ) {}

  async request(routerId: string, user: AuthUser | null, meta?: RequestMeta) {
    const exists = await this.prisma.router.count({ where: { id: routerId } });
    if (!exists) throw new NotFoundException('Router not found');
    const backup = await this.prisma.backup.create({
      data: { routerId, type: BackupType.EXPORT, status: JobStatus.PENDING, createdById: user?.id },
      select: LIST_SELECT,
    });
    await this.queue.add(JOB_BACKUP_ROUTER, { backupId: backup.id }, { attempts: 2, backoff: { type: 'exponential', delay: 30_000 } });
    if (user) {
      await this.audit.record({
        action: 'BACKUP_REQUEST',
        user,
        meta,
        routerId,
        targetType: 'backup',
        targetId: backup.id,
        result: 'SUCCESS',
      });
    }
    return backup;
  }

  async requestAll(user: AuthUser, meta: RequestMeta) {
    await this.queue.add(JOB_BACKUP_ALL, { requestedBy: user.id });
    await this.audit.record({ action: 'BACKUP_ALL_REQUEST', user, meta, targetType: 'backup', result: 'SUCCESS' });
    return { queued: true };
  }

  list(routerId: string) {
    return this.prisma.backup.findMany({
      where: { routerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: LIST_SELECT,
    });
  }

  async get(id: string) {
    const b = await this.prisma.backup.findUnique({
      where: { id },
      include: { router: { select: { id: true, name: true } } },
    });
    if (!b) throw new NotFoundException('Backup not found');
    return b;
  }

  /** Unified diff between two exports; `from` defaults to the previous successful backup of the same router. */
  async diff(toId: string, fromId?: string) {
    const to = await this.get(toId);
    const from = fromId
      ? await this.get(fromId)
      : await this.prisma.backup.findFirst({
          where: { routerId: to.routerId, status: JobStatus.SUCCESS, createdAt: { lt: to.createdAt } },
          orderBy: { createdAt: 'desc' },
          include: { router: { select: { id: true, name: true } } },
        });
    if (!from) throw new NotFoundException('No earlier backup to compare with');
    if (from.routerId !== to.routerId) throw new BadRequestException('Backups belong to different routers');
    if (!from.content || !to.content) throw new BadRequestException('Both backups must have completed');
    return {
      from: { id: from.id, createdAt: from.createdAt },
      to: { id: to.id, createdAt: to.createdAt },
      identical: from.sha256 === to.sha256,
      patch: configDiff(from.createdAt.toISOString(), from.content, to.createdAt.toISOString(), to.content),
    };
  }
}
