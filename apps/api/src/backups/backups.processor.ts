import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { createHash } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/env';
import { MikrotikService } from '../mikrotik/mikrotik.service';
import { PrismaService } from '../prisma/prisma.service';
import { BACKUP_QUEUE, BackupsService, JOB_BACKUP_ALL, JOB_BACKUP_ROUTER } from './backups.service';

@Processor(BACKUP_QUEUE, { concurrency: 5 })
export class BackupsProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(BackupsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mikrotik: MikrotikService,
    private readonly backups: BackupsService,
    @InjectQueue(BACKUP_QUEUE) private readonly queue: Queue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
  }

  /** Idempotently registers the scheduled "backup all routers" job (default daily 03:00). */
  async onModuleInit() {
    await this.queue.upsertJobScheduler('scheduled-backup-all', { pattern: this.config.backupCron }, { name: JOB_BACKUP_ALL });
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === JOB_BACKUP_ALL) {
      const routers = await this.prisma.router.findMany({ select: { id: true } });
      for (const r of routers) await this.backups.request(r.id, null);
      return { enqueued: routers.length };
    }
    if (job.name === JOB_BACKUP_ROUTER) return this.backupRouter(job.data.backupId as string, job);
    throw new Error(`Unknown job ${job.name}`);
  }

  private async backupRouter(backupId: string, job: Job) {
    const backup = await this.prisma.backup.update({ where: { id: backupId }, data: { status: JobStatus.RUNNING } });
    try {
      const content = await this.mikrotik.exportConfig(backup.routerId);
      if (!content.includes('/')) throw new Error('Export returned no configuration');
      const sha256 = createHash('sha256').update(content).digest('hex');
      await this.prisma.backup.update({
        where: { id: backupId },
        data: {
          status: JobStatus.SUCCESS,
          content,
          sha256,
          sizeBytes: Buffer.byteLength(content),
          error: null,
          finishedAt: new Date(),
        },
      });
      return { sha256 };
    } catch (e) {
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.prisma.backup.update({
        where: { id: backupId },
        data: {
          status: final ? JobStatus.FAILED : JobStatus.PENDING,
          error: (e as Error).message,
          finishedAt: final ? new Date() : null,
        },
      });
      this.logger.warn(`Backup ${backupId} failed: ${(e as Error).message}`);
      throw e;
    }
  }
}
