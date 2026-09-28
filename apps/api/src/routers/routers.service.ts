import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RouterStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth/decorators';
import { CryptoService } from '../common/crypto/crypto.service';
import { RouterAuthError } from '../mikrotik/errors';
import { MikrotikService } from '../mikrotik/mikrotik.service';
import type { RouterOsClient } from '../mikrotik/routeros.client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRouterDto, RouterGroupDto, UpdateRouterDto, UpdateRouterGroupDto } from './routers.dto';

/** Never select the credential relation — only the (non-secret) username. */
const ROUTER_SELECT = {
  id: true,
  name: true,
  host: true,
  port: true,
  connectionType: true,
  useTls: true,
  verifyTls: true,
  sshPort: true,
  sshHostKeySha256: true,
  location: true,
  tags: true,
  status: true,
  lastSeenAt: true,
  identity: true,
  boardName: true,
  version: true,
  architecture: true,
  serialNumber: true,
  createdAt: true,
  updatedAt: true,
  group: { select: { id: true, name: true } },
  credential: { select: { username: true } },
} satisfies Prisma.RouterSelect;

type RouterRow = Prisma.RouterGetPayload<{ select: typeof ROUTER_SELECT }>;

const present = ({ credential, ...r }: RouterRow) => ({ ...r, username: credential?.username ?? null });

@Injectable()
export class RoutersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly mikrotik: MikrotikService,
    private readonly audit: AuditService,
  ) {}

  async list(groupId?: string) {
    const rows = await this.prisma.router.findMany({
      where: groupId ? { groupId } : undefined,
      select: ROUTER_SELECT,
      orderBy: { name: 'asc' },
    });
    return rows.map(present);
  }

  async get(id: string) {
    const row = await this.prisma.router.findUnique({ where: { id }, select: ROUTER_SELECT });
    if (!row) throw new NotFoundException('Router not found');
    return present(row);
  }

  async create(dto: CreateRouterDto, user: AuthUser, meta: RequestMeta) {
    const { username, password, testConnection = true, ...fields } = dto;
    const id = randomUUID();

    if (testConnection) {
      const client = await this.mikrotik.probe({
        id,
        host: fields.host,
        port: fields.port,
        connectionType: fields.connectionType,
        useTls: fields.useTls,
        verifyTls: fields.verifyTls,
        sshPort: fields.sshPort ?? 22,
        username,
        password,
      });
      try {
        await client.getIdentity();
      } finally {
        await client.adapter.close();
      }
    }

    const created = await this.audit.track(
      { action: 'ROUTER_CREATE', user, meta, routerId: id, targetType: 'router', targetId: id, after: { ...fields, username } },
      () =>
        this.prisma.router.create({
          data: {
            id,
            ...fields,
            credential: {
              create: {
                username,
                passwordEnc: this.crypto.encrypt(password, `router:${id}`),
                keyVersion: this.crypto.activeKeyVersion,
              },
            },
          },
          select: ROUTER_SELECT,
        }),
    );
    await this.refresh(id).catch(() => undefined);
    return this.get(created.id);
  }

  async update(id: string, dto: UpdateRouterDto, user: AuthUser, meta: RequestMeta) {
    const before = await this.get(id);
    const { username, password, testConnection: _ignored, ...fields } = dto;
    const connectionChanged = ['host', 'port', 'connectionType', 'useTls'].some(
      (k) => fields[k as keyof typeof fields] !== undefined && fields[k as keyof typeof fields] !== before[k as keyof typeof before],
    );

    await this.audit.track(
      {
        action: 'ROUTER_UPDATE',
        user,
        meta,
        routerId: id,
        targetType: 'router',
        targetId: id,
        before,
        after: { ...fields, ...(username ? { username } : {}), ...(password ? { password: '(rotated)' } : {}) },
      },
      () =>
        this.prisma.router.update({
          where: { id },
          data: {
            ...fields,
            // A new address may be a different device: re-pin its SSH host key on next use.
            ...(connectionChanged ? { sshHostKeySha256: null } : {}),
            ...(username || password
              ? {
                  credential: {
                    update: {
                      ...(username ? { username } : {}),
                      ...(password
                        ? {
                            passwordEnc: this.crypto.encrypt(password, `router:${id}`),
                            keyVersion: this.crypto.activeKeyVersion,
                            rotatedAt: new Date(),
                          }
                        : {}),
                    },
                  },
                }
              : {}),
          },
        }),
    );
    await this.mikrotik.invalidate(id);
    return this.get(id);
  }

  async remove(id: string, user: AuthUser, meta: RequestMeta) {
    const before = await this.get(id);
    await this.audit.track(
      { action: 'ROUTER_DELETE', user, meta, routerId: null, targetType: 'router', targetId: id, before },
      () => this.prisma.router.delete({ where: { id } }),
    );
    await this.mikrotik.invalidate(id);
  }

  /** Clears a pinned SSH host key (after a legitimate router reinstall). */
  async resetSshHostKey(id: string, user: AuthUser, meta: RequestMeta) {
    const before = await this.get(id);
    await this.audit.track(
      {
        action: 'ROUTER_SSH_HOSTKEY_RESET',
        user,
        meta,
        routerId: id,
        targetType: 'router',
        targetId: id,
        before: { sshHostKeySha256: before.sshHostKeySha256 },
      },
      () => this.prisma.router.update({ where: { id }, data: { sshHostKeySha256: null } }),
    );
  }

  /**
   * Contacts the router, refreshes identity/version metadata and status.
   * Returns the live system resource snapshot.
   */
  async refresh(id: string) {
    try {
      const snapshot = await this.mikrotik.withClient(id, (c) => this.snapshot(c));
      await this.prisma.router.update({
        where: { id },
        data: {
          status: RouterStatus.ONLINE,
          lastSeenAt: new Date(),
          identity: snapshot.identity,
          version: snapshot.resource.version,
          boardName: snapshot.resource.boardName,
          architecture: snapshot.resource.architecture,
          serialNumber: snapshot.routerboard?.['serial-number'] ?? null,
        },
      });
      return snapshot;
    } catch (e) {
      const status = e instanceof RouterAuthError ? RouterStatus.AUTH_FAILED : RouterStatus.OFFLINE;
      await this.prisma.router.update({ where: { id }, data: { status } }).catch(() => undefined);
      throw e;
    }
  }

  private async snapshot(c: RouterOsClient) {
    const [identity, resource, routerboard] = await Promise.all([
      c.getIdentity(),
      c.getSystemResource(),
      c.getRouterboard(),
    ]);
    return { identity, resource, routerboard };
  }

  // ── Groups ──────────────────────────────────────────────
  listGroups() {
    return this.prisma.routerGroup.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { routers: true } } },
    });
  }

  async createGroup(dto: RouterGroupDto, user: AuthUser, meta: RequestMeta) {
    return this.audit.track(
      { action: 'ROUTER_GROUP_CREATE', user, meta, targetType: 'router-group', after: dto, targetIdFrom: (g: { id: string }) => g.id },
      () =>
      this.prisma.routerGroup.create({ data: dto }),
    );
  }

  async updateGroup(id: string, dto: UpdateRouterGroupDto, user: AuthUser, meta: RequestMeta) {
    const before = await this.prisma.routerGroup.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Group not found');
    if (dto.parentId && (await this.isDescendant(dto.parentId, id))) {
      throw new BadRequestException('A group cannot be moved under itself');
    }
    return this.audit.track(
      { action: 'ROUTER_GROUP_UPDATE', user, meta, targetType: 'router-group', targetId: id, before, after: dto },
      () => this.prisma.routerGroup.update({ where: { id }, data: dto }),
    );
  }

  async removeGroup(id: string, user: AuthUser, meta: RequestMeta) {
    const before = await this.prisma.routerGroup.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Group not found');
    await this.audit.track(
      { action: 'ROUTER_GROUP_DELETE', user, meta, targetType: 'router-group', targetId: id, before },
      () => this.prisma.routerGroup.delete({ where: { id } }),
    );
  }

  /** Router ids in a group and all of its sub-groups. */
  async routerIdsInGroup(groupId: string): Promise<string[]> {
    const groups = await this.prisma.routerGroup.findMany({ select: { id: true, parentId: true } });
    const ids = new Set([groupId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const g of groups) {
        if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
          ids.add(g.id);
          grew = true;
        }
      }
    }
    const routers = await this.prisma.router.findMany({ where: { groupId: { in: [...ids] } }, select: { id: true } });
    return routers.map((r) => r.id);
  }

  private async isDescendant(candidate: string, ancestor: string): Promise<boolean> {
    let cur: string | null = candidate;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === ancestor) return true;
      seen.add(cur);
      const g: { parentId: string | null } | null = await this.prisma.routerGroup.findUnique({
        where: { id: cur },
        select: { parentId: true },
      });
      cur = g?.parentId ?? null;
    }
    return false;
  }
}
