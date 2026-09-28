import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth/decorators';
import { MikrotikService } from '../mikrotik/mikrotik.service';
import type { RosProps, RosRecord } from '../mikrotik/types';
import { HIDDEN_PROPS, ResourceSpec } from './resources';
import { camelToKebab, toRosProps } from './ros-props';

interface Actor {
  user: AuthUser;
  meta: RequestMeta;
}

/**
 * Generic, audited CRUD over RouterOS menus. Every mutation records who did what, where,
 * with the item's state before and after the change.
 */
@Injectable()
export class NetworkService {
  constructor(
    private readonly mikrotik: MikrotikService,
    private readonly audit: AuditService,
  ) {}

  async list(routerId: string, spec: ResourceSpec, where?: Record<string, string>): Promise<RosRecord[]> {
    const rows = await this.mikrotik.withClient(routerId, (c) => c.list(spec.path, where));
    return rows.map((r) => this.sanitize(spec, r));
  }

  async create(routerId: string, spec: ResourceSpec, dto: object, actor: Actor): Promise<RosRecord> {
    const props = toRosProps(dto);
    return this.mikrotik.withClient(routerId, (c) =>
      this.audit.track(
        {
          action: `${spec.audit}_CREATE`,
          ...actor,
          routerId,
          targetType: spec.key,
          after: (item: RosRecord) => item,
          targetIdFrom: (item: RosRecord) => item['.id'],
        },
        async () => {
          const id = await c.add(spec.path, props);
          return id ? this.sanitize(spec, await c.get(spec.path, id)) : this.sanitize(spec, props);
        },
      ),
    );
  }

  /** Fields set to `null` in the DTO are unset (reset to the RouterOS default). */
  async update(routerId: string, spec: ResourceSpec, id: string, dto: object, actor: Actor): Promise<RosRecord> {
    const props = toRosProps(dto);
    const unset = Object.entries(dto)
      .filter(([, v]) => v === null)
      .map(([k]) => camelToKebab(k));
    return this.mikrotik.withClient(routerId, async (c) => {
      const before = this.sanitize(spec, await c.get(spec.path, id));
      return this.audit.track(
        {
          action: `${spec.audit}_UPDATE`,
          ...actor,
          routerId,
          targetType: spec.key,
          targetId: id,
          before,
          after: (item: RosRecord) => item,
        },
        async () => {
          if (Object.keys(props).length) await c.set(spec.path, id, props);
          for (const name of unset) await c.unset(spec.path, id, name);
          return this.sanitize(spec, await c.get(spec.path, id));
        },
      );
    });
  }

  async remove(routerId: string, spec: ResourceSpec, id: string, actor: Actor): Promise<void> {
    await this.mikrotik.withClient(routerId, async (c) => {
      const before = this.sanitize(spec, await c.get(spec.path, id));
      await this.audit.track(
        { action: `${spec.audit}_DELETE`, ...actor, routerId, targetType: spec.key, targetId: id, before },
        () => c.remove(spec.path, id),
      );
    });
  }

  async setDisabled(routerId: string, spec: ResourceSpec, id: string, disabled: boolean, actor: Actor) {
    return this.update(routerId, spec, id, { disabled }, actor);
  }

  async move(routerId: string, spec: ResourceSpec, id: string, beforeId: string, actor: Actor): Promise<void> {
    await this.mikrotik.withClient(routerId, (c) =>
      this.audit.track(
        {
          action: `${spec.audit}_MOVE`,
          ...actor,
          routerId,
          targetType: spec.key,
          targetId: id,
          after: { placeBefore: beforeId },
        },
        () => c.move(spec.path, id, beforeId),
      ),
    );
  }

  async makeStaticLease(routerId: string, spec: ResourceSpec, id: string, actor: Actor): Promise<void> {
    await this.mikrotik.withClient(routerId, async (c) => {
      const before = await c.get(spec.path, id);
      await this.audit.track(
        { action: `${spec.audit}_MAKE_STATIC`, ...actor, routerId, targetType: spec.key, targetId: id, before },
        () => c.makeStaticLease(id),
      );
    });
  }

  logs(routerId: string, limit: number, topic?: string) {
    return this.mikrotik.withClient(routerId, (c) => c.logs(limit, topic));
  }

  async reboot(routerId: string, actor: Actor): Promise<void> {
    await this.audit.track({ action: 'SYSTEM_REBOOT', ...actor, routerId, targetType: 'system' }, async () => {
      await this.mikrotik
        .withClient(routerId, (c) => c.reboot())
        // The router drops the connection while rebooting; that is the expected outcome.
        .catch((e: Error) => {
          if (!/closed|timeout|ECONNRESET|socket hang up/i.test(e.message)) throw e;
        });
    });
    await this.mikrotik.invalidate(routerId);
  }

  async system(routerId: string) {
    return this.mikrotik.withClient(routerId, async (c) => {
      const [resource, identity, routerboard, temperature] = await Promise.all([
        c.getSystemResource(),
        c.getIdentity(),
        c.getRouterboard(),
        c.getTemperature(),
      ]);
      return { identity, resource, routerboard, temperature };
    });
  }

  private sanitize(spec: ResourceSpec, row: RosRecord | RosProps): RosRecord {
    const hidden = HIDDEN_PROPS[spec.key];
    if (!hidden) return row;
    return Object.fromEntries(Object.entries(row).filter(([k]) => !hidden.includes(k)));
  }
}
