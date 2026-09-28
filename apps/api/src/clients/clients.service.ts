import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth/decorators';
import { RouterCommandError, RouterNotFoundError } from '../mikrotik/errors';
import { MikrotikService } from '../mikrotik/mikrotik.service';
import type { RouterOsClient } from '../mikrotik/routeros.client';
import type { RosRecord } from '../mikrotik/types';
import { liveKey, RouterLive } from '../monitoring/live';
import { RedisService } from '../redis/redis.module';
import {
  BLOCK_LIST,
  BLOCK_RULE_COMMENTS,
  managedQueueName,
  mergeClients,
  NetworkClient,
  singleHostTarget,
} from './client-model';
import { ClientUsageService } from './client-usage.service';

interface Actor {
  user: AuthUser;
  meta: RequestMeta;
}

export interface ClientRef {
  address?: string;
  pppUser?: string;
}

const isTrue = (v: string | undefined) => v === 'true' || v === 'yes';
const MAX_CONNECTIONS_TO_DROP = 5000;

/** Host part of a conntrack address: "1.2.3.4:5000" → "1.2.3.4", "[2001:db8::1]:443" → "2001:db8::1". */
function connHost(addr: string | undefined): string {
  if (!addr) return '';
  const v6 = /^\[(.+)\]:\d+$/.exec(addr);
  if (v6) return v6[1];
  return addr.includes('.') ? addr.replace(/:\d+$/, '') : addr;
}

/**
 * Network clients: who is connected, how much they use, and the two levers an admin needs
 * for a heavy downloader — limit their bandwidth, or block them.
 *
 *  IP clients (DHCP / hotspot / static): limit = simple queue "nms-<ip>" placed first;
 *                                         block = address list "nms-blocked" + forward drop rules.
 *  PPP clients: limit = rate-limit on the PPP secret (applied on reconnect);
 *               block = disable the PPP secret and disconnect the session.
 */
@Injectable()
export class ClientsService {
  constructor(
    private readonly mikrotik: MikrotikService,
    private readonly usage: ClientUsageService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async list(routerId: string) {
    const [tables, live, today] = await Promise.all([
      this.mikrotik.withClient(routerId, async (c) => {
        const optional = (p: Promise<RosRecord[]>) => p.catch(() => [] as RosRecord[]);
        const [leases, arp, pppActive, pppSecrets, hotspotActive, queues, interfaces, addressList, dhcpServers] =
          await Promise.all([
            c.list('/ip/dhcp-server/lease'),
            c.list('/ip/arp'),
            optional(c.list('/ppp/active')),
            optional(c.adapter.print('/ppp/secret', { proplist: ['.id', 'name', 'disabled', 'rate-limit', 'comment', 'service'] })),
            // Not every router runs a hotspot (or has the menu at all).
            optional(c.list('/ip/hotspot/active')),
            c.list('/queue/simple'),
            c.adapter.print('/interface', { proplist: ['name', 'rx-byte', 'tx-byte'] }),
            c.list('/ip/firewall/address-list', { list: BLOCK_LIST }),
            optional(c.list('/ip/dhcp-server')),
          ]);
        return { leases, arp, pppActive, pppSecrets, hotspotActive, queues, interfaces, addressList, dhcpServers };
      }),
      this.redis.client.get(liveKey(routerId)).then((r) => (r ? (JSON.parse(r) as RouterLive) : null)),
      this.usage.today(routerId),
    ]);

    const liveInterfaceRates = new Map((live?.interfaces ?? []).map((i) => [i.name, { rxBps: i.rxBps, txBps: i.txBps }]));
    const clients = mergeClients({ ...tables, liveInterfaceRates }).map((c) => ({
      ...c,
      todayDownloadBytes: today.get(c.key)?.down ?? 0,
      todayUploadBytes: today.get(c.key)?.up ?? 0,
    }));

    const sum = (f: (c: NetworkClient) => number | null) => clients.reduce((a, c) => a + (f(c) ?? 0), 0);
    return {
      summary: {
        total: clients.length,
        online: clients.filter((c) => c.online).length,
        blocked: clients.filter((c) => c.blocked).length,
        limited: clients.filter((c) => c.limit).length,
        downloadBps: sum((c) => c.downloadBps),
        uploadBps: sum((c) => c.uploadBps),
      },
      clients,
    };
  }

  // ── Limit ────────────────────────────────────────────────────────────
  async limit(routerId: string, ref: ClientRef, rate: { download: string; upload: string; comment?: string; reconnect?: boolean }, actor: Actor) {
    const maxLimit = `${rate.upload}/${rate.download}`;
    if (ref.pppUser) {
      const user = ref.pppUser;
      return this.mikrotik.withClient(routerId, async (c) => {
        const secret = await this.pppSecret(c, user);
        return this.audit.track(
          {
            action: 'CLIENT_LIMIT',
            ...actor,
            routerId,
            targetType: 'client.ppp',
            targetId: user,
            before: { 'rate-limit': secret['rate-limit'] ?? null },
            after: { 'rate-limit': maxLimit, reconnect: !!rate.reconnect },
          },
          async () => {
            await c.set('/ppp/secret', secret['.id'], { 'rate-limit': maxLimit });
            const reconnected = rate.reconnect ? await this.disconnectPpp(c, user) : 0;
            return { applied: rate.reconnect ? 'now' : 'on-next-connect', reconnected };
          },
        );
      });
    }

    const address = this.requireAddress(ref);
    return this.mikrotik.withClient(routerId, async (c) => {
      const queues = await c.list('/queue/simple');
      const existing = queues.find((q) => !isTrue(q.dynamic) && singleHostTarget(q.target) === address);
      return this.audit.track(
        {
          action: 'CLIENT_LIMIT',
          ...actor,
          routerId,
          targetType: 'client.ip',
          targetId: address,
          before: existing ?? null,
          after: { 'max-limit': maxLimit },
        },
        async () => {
          if (existing) {
            await c.set('/queue/simple', existing['.id'], {
              'max-limit': maxLimit,
              ...(rate.comment ? { comment: rate.comment } : {}),
            });
            return { queueId: existing['.id'], queueName: existing.name, created: false };
          }
          const id = await this.addClientQueue(c, queues, address, maxLimit, rate.comment);
          return { queueId: id, queueName: managedQueueName(address), created: true };
        },
      );
    });
  }

  async unlimit(routerId: string, ref: ClientRef, reconnect: boolean, actor: Actor) {
    if (ref.pppUser) {
      const user = ref.pppUser;
      return this.mikrotik.withClient(routerId, async (c) => {
        const secret = await this.pppSecret(c, user);
        return this.audit.track(
          {
            action: 'CLIENT_UNLIMIT',
            ...actor,
            routerId,
            targetType: 'client.ppp',
            targetId: user,
            before: { 'rate-limit': secret['rate-limit'] ?? null },
          },
          async () => {
            if (secret['rate-limit']) await c.unset('/ppp/secret', secret['.id'], 'rate-limit');
            const reconnected = reconnect ? await this.disconnectPpp(c, user) : 0;
            // The PPP profile may still impose its own rate-limit.
            return { applied: reconnect ? 'now' : 'on-next-connect', reconnected };
          },
        );
      });
    }

    const address = this.requireAddress(ref);
    return this.mikrotik.withClient(routerId, async (c) => {
      const queues = await c.list('/queue/simple');
      const existing = queues.find((q) => !isTrue(q.dynamic) && singleHostTarget(q.target) === address);
      if (!existing) throw new NotFoundException('This client has no bandwidth limit');
      // Keep the queue with 0/0 (unlimited) so usage keeps being counted.
      await this.audit.track(
        { action: 'CLIENT_UNLIMIT', ...actor, routerId, targetType: 'client.ip', targetId: address, before: existing },
        () => c.set('/queue/simple', existing['.id'], { 'max-limit': '0/0' }),
      );
      return { queueId: existing['.id'] };
    });
  }

  /** Starts usage accounting for IP clients by giving each an unlimited (0/0) queue. */
  async track(routerId: string, addresses: string[], actor: Actor) {
    return this.mikrotik.withClient(routerId, async (c) => {
      const queues = await c.list('/queue/simple');
      const covered = new Set(queues.filter((q) => !isTrue(q.dynamic)).map((q) => singleHostTarget(q.target)));
      const todo = [...new Set(addresses)].filter((a) => !covered.has(a));
      await this.audit.track(
        { action: 'CLIENT_TRACK', ...actor, routerId, targetType: 'client.ip', after: { addresses: todo } },
        async () => {
          for (const a of todo) await this.addClientQueue(c, queues, a, '0/0');
        },
      );
      return { created: todo.length, alreadyTracked: addresses.length - todo.length };
    });
  }

  // ── Block ────────────────────────────────────────────────────────────
  async block(routerId: string, ref: ClientRef, opts: { reason?: string; duration?: string }, actor: Actor) {
    const reason = opts.reason?.trim() || 'blocked';
    if (ref.pppUser) {
      const user = ref.pppUser;
      return this.mikrotik.withClient(routerId, async (c) => {
        const secret = await this.pppSecret(c, user);
        if (opts.duration) throw new BadRequestException('Timed blocks are only supported for IP clients');
        return this.audit.track(
          {
            action: 'CLIENT_BLOCK',
            ...actor,
            routerId,
            targetType: 'client.ppp',
            targetId: user,
            before: { disabled: secret.disabled },
            after: { disabled: 'yes', reason },
          },
          async () => {
            await c.set('/ppp/secret', secret['.id'], { disabled: 'yes' });
            return { disconnected: await this.disconnectPpp(c, user) };
          },
        );
      });
    }

    const address = this.requireAddress(ref);
    return this.mikrotik.withClient(routerId, async (c) => {
      const existing = await c.list('/ip/firewall/address-list', { list: BLOCK_LIST });
      const already = existing.find((e) => e.address === address || e.address === `${address}/32`);
      return this.audit.track(
        {
          action: 'CLIENT_BLOCK',
          ...actor,
          routerId,
          targetType: 'client.ip',
          targetId: address,
          after: { list: BLOCK_LIST, reason, timeout: opts.duration ?? null },
        },
        async () => {
          const rulesCreated = await this.ensureBlockRules(c);
          if (!already) {
            await c.add('/ip/firewall/address-list', {
              list: BLOCK_LIST,
              address,
              comment: `${reason} — by ${actor.user.username}`.slice(0, 255),
              ...(opts.duration ? { timeout: opts.duration } : {}),
            });
          }
          // Established (and fast-tracked) connections bypass the new drop rule until they end,
          // so cut the client's existing connections to make the block immediate.
          const connectionsDropped = await this.dropConnections(c, address);
          return { rulesCreated, connectionsDropped, alreadyBlocked: !!already };
        },
      );
    });
  }

  async unblock(routerId: string, ref: ClientRef, actor: Actor) {
    if (ref.pppUser) {
      const user = ref.pppUser;
      return this.mikrotik.withClient(routerId, async (c) => {
        const secret = await this.pppSecret(c, user);
        await this.audit.track(
          { action: 'CLIENT_UNBLOCK', ...actor, routerId, targetType: 'client.ppp', targetId: user, before: { disabled: secret.disabled } },
          () => c.set('/ppp/secret', secret['.id'], { disabled: 'no' }),
        );
        return { unblocked: true };
      });
    }

    const address = this.requireAddress(ref);
    return this.mikrotik.withClient(routerId, async (c) => {
      const entries = (await c.list('/ip/firewall/address-list', { list: BLOCK_LIST })).filter(
        (e) => e.address === address || e.address === `${address}/32`,
      );
      if (!entries.length) throw new NotFoundException('This client is not blocked');
      await this.audit.track(
        { action: 'CLIENT_UNBLOCK', ...actor, routerId, targetType: 'client.ip', targetId: address, before: entries },
        async () => {
          for (const e of entries) await c.remove('/ip/firewall/address-list', e['.id']);
        },
      );
      return { unblocked: true };
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────
  private requireAddress(ref: ClientRef): string {
    if (!ref.address) throw new BadRequestException('address or pppUser is required');
    return ref.address;
  }

  private async pppSecret(c: RouterOsClient, user: string): Promise<RosRecord> {
    const [secret] = await c.adapter.print('/ppp/secret', {
      where: { name: user },
      proplist: ['.id', 'name', 'disabled', 'rate-limit', 'comment'],
    });
    if (!secret) throw new NotFoundException(`PPP user ${user} has no secret on this router (RADIUS users are managed on the RADIUS server)`);
    return secret;
  }

  private async disconnectPpp(c: RouterOsClient, user: string): Promise<number> {
    const sessions = await c.list('/ppp/active', { name: user });
    for (const s of sessions) await c.remove('/ppp/active', s['.id']);
    return sessions.length;
  }

  /** Adds "nms-<ip>" at the top of the queue list so it wins over broader subnet queues. */
  private async addClientQueue(c: RouterOsClient, queues: RosRecord[], address: string, maxLimit: string, comment?: string) {
    const first = queues.find((q) => !isTrue(q.dynamic));
    return c.add('/queue/simple', {
      name: managedQueueName(address),
      target: address.includes(':') ? `${address}/128` : `${address}/32`,
      'max-limit': maxLimit,
      comment: comment ?? 'managed by NMS',
      ...(first ? { 'place-before': first['.id'] } : {}),
    });
  }

  /** Creates the two forward-chain drop rules for the block list once, at the top of the filter. */
  private async ensureBlockRules(c: RouterOsClient): Promise<number> {
    const rules = await c.list('/ip/firewall/filter');
    const first = rules.find((r) => !isTrue(r.dynamic));
    let created = 0;
    for (const [comment, prop] of [
      [BLOCK_RULE_COMMENTS.src, 'src-address-list'],
      [BLOCK_RULE_COMMENTS.dst, 'dst-address-list'],
    ] as const) {
      if (rules.some((r) => r.comment === comment)) continue;
      await c.add('/ip/firewall/filter', {
        chain: 'forward',
        action: 'drop',
        [prop]: BLOCK_LIST,
        comment,
        ...(first ? { 'place-before': first['.id'] } : {}),
      });
      created++;
    }
    return created;
  }

  private async dropConnections(c: RouterOsClient, address: string): Promise<number> {
    const conns = await c.adapter
      .print('/ip/firewall/connection', { proplist: ['.id', 'src-address', 'dst-address'] })
      .catch(() => [] as RosRecord[]);
    const mine = conns
      .filter((x) => connHost(x['src-address']) === address || connHost(x['dst-address']) === address)
      .slice(0, MAX_CONNECTIONS_TO_DROP);
    let dropped = 0;
    for (let i = 0; i < mine.length; i += 20) {
      const batch = mine.slice(i, i + 20);
      const results = await Promise.allSettled(batch.map((x) => c.remove('/ip/firewall/connection', x['.id'])));
      for (const r of results) {
        if (r.status === 'fulfilled') dropped++;
        // A connection that ended meanwhile is fine; anything else is a real failure.
        else if (!(r.reason instanceof RouterNotFoundError || r.reason instanceof RouterCommandError)) throw r.reason;
      }
    }
    return dropped;
  }
}

