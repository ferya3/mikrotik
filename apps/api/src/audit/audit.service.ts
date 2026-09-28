import { Injectable, Logger } from '@nestjs/common';
import { AuditResult, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestMeta } from '../common/auth/decorators';

export interface AuditEntry {
  action: string;
  user?: { id?: string; username: string } | null;
  meta?: RequestMeta;
  routerId?: string | null;
  targetType?: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  result: AuditResult;
  error?: string;
}

const SECRET_KEYS = /pass(word)?|secret|token|key|totp/i;

/** Recursively masks values whose key looks secret, so audit rows never contain credentials. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '***' : redact(v)]),
    );
  }
  return value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(e: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: e.action,
          userId: e.user?.id,
          username: e.user?.username,
          routerId: e.routerId ?? undefined,
          targetType: e.targetType,
          targetId: e.targetId ?? undefined,
          before: toJson(e.before),
          after: toJson(e.after),
          result: e.result,
          error: e.error?.slice(0, 2000),
          ip: e.meta?.ip,
          userAgent: e.meta?.userAgent?.slice(0, 255),
        },
      });
    } catch (err) {
      // Auditing must never be silently lost: surface loudly in the process log.
      this.logger.error(`Failed to write audit log for ${e.action}: ${(err as Error).message}`);
    }
  }

  /**
   * Runs a mutation and records SUCCESS/FAILURE with before/after snapshots.
   * `after` may be a function of the mutation result.
   */
  async track<T>(
    base: Omit<AuditEntry, 'result' | 'after' | 'error'> & {
      after?: unknown | ((r: T) => unknown);
      /** Derives the target id from the result, e.g. the id RouterOS assigned to a new rule. */
      targetIdFrom?: (r: T) => string | undefined;
    },
    fn: () => Promise<T>,
  ): Promise<T> {
    const { targetIdFrom, ...entry } = base;
    try {
      const result = await fn();
      const after = typeof entry.after === 'function' ? (entry.after as (r: T) => unknown)(result) : entry.after;
      const targetId = targetIdFrom?.(result) ?? entry.targetId;
      await this.record({ ...entry, targetId, after, result: AuditResult.SUCCESS });
      return result;
    } catch (err) {
      const after = typeof entry.after === 'function' ? undefined : entry.after;
      await this.record({ ...entry, after, result: AuditResult.FAILURE, error: (err as Error).message });
      throw err;
    }
  }

  async list(q: { routerId?: string; userId?: string; action?: string; take: number; cursor?: string }) {
    const where: Prisma.AuditLogWhereInput = {
      routerId: q.routerId,
      userId: q.userId,
      action: q.action ? { contains: q.action, mode: 'insensitive' } : undefined,
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { router: { select: { id: true, name: true } } },
    });
    const hasMore = rows.length > q.take;
    const items = hasMore ? rows.slice(0, q.take) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }
}

function toJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(redact(v), (_k, val) => (typeof val === 'bigint' ? val.toString() : val)));
}
