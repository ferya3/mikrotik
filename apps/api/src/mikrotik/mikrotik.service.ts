import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import { CryptoService } from '../common/crypto/crypto.service';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { RouterOsApiClient } from './api/api-client';
import { ApiRouterAdapter } from './api/api.adapter';
import { RouterAuthError, RouterConnectionError } from './errors';
import { RestRouterAdapter } from './rest/rest.adapter';
import { RouterOsClient } from './routeros.client';
import { runSshCommand, SSH_COMMANDS } from './ssh/ssh.executor';
import type { RouterAdapter, RouterConnectionInfo } from './types';

const IDLE_CLOSE_MS = 60_000;

interface PooledAdapter {
  adapter: RouterAdapter;
  /** Changes whenever connection settings or credentials change, invalidating the pool entry. */
  fingerprint: string;
  lastUsed: number;
}

/**
 * Single entry point to a router. Decrypts credentials on demand (they are never cached in plaintext
 * beyond the lifetime of a pooled connection), picks the transport and pools API connections.
 */
@Injectable()
export class MikrotikService implements OnModuleDestroy {
  private readonly logger = new Logger(MikrotikService.name);
  private readonly pool = new Map<string, PooledAdapter>();
  private readonly connecting = new Map<string, Promise<PooledAdapter>>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.sweeper = setInterval(() => this.sweep(), IDLE_CLOSE_MS / 2);
    this.sweeper.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.sweeper);
    await Promise.all([...this.pool.values()].map((p) => p.adapter.close().catch(() => undefined)));
    this.pool.clear();
  }

  /**
   * Runs `fn` against the router. On a transport error the pooled connection is dropped
   * so the next call reconnects instead of reusing a dead socket.
   */
  async withClient<T>(routerId: string, fn: (c: RouterOsClient) => Promise<T>): Promise<T> {
    const client = await this.client(routerId);
    try {
      return await fn(client);
    } catch (e) {
      if (e instanceof RouterConnectionError || e instanceof RouterAuthError) await this.invalidate(routerId);
      throw e;
    }
  }

  /** Returns a client for the router, reusing a pooled connection when possible. */
  async client(routerId: string): Promise<RouterOsClient> {
    const info = await this.connectionInfo(routerId);
    const fingerprint = this.fingerprint(info);
    const pooled = this.pool.get(routerId);
    if (pooled && pooled.fingerprint === fingerprint && this.isAlive(pooled.adapter)) {
      pooled.lastUsed = Date.now();
      return new RouterOsClient(pooled.adapter);
    }
    if (pooled) {
      this.pool.delete(routerId);
      pooled.adapter.close().catch(() => undefined);
    }

    let pending = this.connecting.get(routerId);
    if (!pending) {
      pending = this.open(info)
        .then((adapter) => {
          const entry = { adapter, fingerprint, lastUsed: Date.now() };
          this.pool.set(routerId, entry);
          return entry;
        })
        .finally(() => this.connecting.delete(routerId));
      this.connecting.set(routerId, pending);
    }
    return new RouterOsClient((await pending).adapter);
  }

  /** Opens a fresh, unpooled connection — used by "test connection" before saving a router. */
  async probe(info: Omit<RouterConnectionInfo, 'timeoutMs'>): Promise<RouterOsClient> {
    return new RouterOsClient(await this.open({ ...info, timeoutMs: this.config.routerTimeoutMs }));
  }

  /** Drops a pooled connection, e.g. after a transport error or a credential change. */
  async invalidate(routerId: string): Promise<void> {
    const pooled = this.pool.get(routerId);
    this.pool.delete(routerId);
    await pooled?.adapter.close().catch(() => undefined);
  }

  /** Full text configuration via SSH (`/export terse`), pinning the host key on first use. */
  async exportConfig(routerId: string): Promise<string> {
    const info = await this.connectionInfo(routerId);
    const res = await runSshCommand(
      {
        host: info.host,
        port: info.sshPort,
        username: info.username,
        password: info.password,
        hostKeySha256: info.sshHostKeySha256,
        timeoutMs: info.timeoutMs,
      },
      SSH_COMMANDS.EXPORT,
    );
    if (!info.sshHostKeySha256 && res.hostKeySha256) {
      await this.prisma.router.update({ where: { id: routerId }, data: { sshHostKeySha256: res.hostKeySha256 } });
      this.logger.log(`Pinned SSH host key for router ${routerId}: ${res.hostKeySha256}`);
    }
    return res.output;
  }

  async connectionInfo(routerId: string): Promise<RouterConnectionInfo> {
    const router = await this.prisma.router.findUnique({ where: { id: routerId }, include: { credential: true } });
    if (!router) throw new NotFoundException('Router not found');
    if (!router.credential) throw new NotFoundException('Router has no credentials');
    return {
      id: router.id,
      host: router.host,
      port: router.port,
      connectionType: router.connectionType,
      useTls: router.useTls,
      verifyTls: router.verifyTls,
      sshPort: router.sshPort,
      sshHostKeySha256: router.sshHostKeySha256,
      username: router.credential.username,
      password: this.crypto.decrypt(router.credential.passwordEnc, `router:${router.id}`),
      timeoutMs: this.config.routerTimeoutMs,
    };
  }

  private async open(info: RouterConnectionInfo): Promise<RouterAdapter> {
    if (info.connectionType === 'REST') {
      return new RestRouterAdapter({
        host: info.host,
        port: info.port,
        tls: info.useTls,
        verifyTls: info.verifyTls,
        username: info.username,
        password: info.password,
        timeoutMs: info.timeoutMs,
      });
    }
    const client = await RouterOsApiClient.connect({
      host: info.host,
      port: info.port ?? (info.useTls ? 8729 : 8728),
      tls: info.useTls,
      verifyTls: info.verifyTls,
      timeoutMs: info.timeoutMs,
    });
    try {
      await client.login(info.username, info.password);
    } catch (e) {
      await client.close();
      throw e;
    }
    return new ApiRouterAdapter(client);
  }

  private isAlive(adapter: RouterAdapter): boolean {
    return !(adapter instanceof ApiRouterAdapter) || adapter.isOpen;
  }

  private fingerprint(i: RouterConnectionInfo): string {
    return createHash('sha256')
      .update([i.host, i.port, i.connectionType, i.useTls, i.verifyTls, i.username, i.password].join('\0'))
      .digest('base64');
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, p] of this.pool) {
      if (now - p.lastUsed > IDLE_CLOSE_MS || !this.isAlive(p.adapter)) {
        this.pool.delete(id);
        p.adapter.close().catch(() => undefined);
      }
    }
  }
}
