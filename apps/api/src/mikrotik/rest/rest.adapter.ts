import * as http from 'http';
import * as https from 'https';
import { describeConnectError, RouterAuthError, RouterCommandError, RouterConnectionError, RouterNotFoundError } from '../errors';
import {
  assertCommand,
  assertId,
  assertPath,
  assertProps,
  MenuPath,
  PrintOptions,
  RosCommand,
  RosProps,
  RosRecord,
  RouterAdapter,
} from '../types';

export interface RestAdapterOptions {
  host: string;
  port?: number | null;
  tls: boolean;
  verifyTls: boolean;
  username: string;
  password: string;
  timeoutMs: number;
}

/** Singleton menus (e.g. /system/resource) return an object instead of an array. */
const asRows = (body: unknown): RosRecord[] =>
  Array.isArray(body) ? (body as RosRecord[]) : body && typeof body === 'object' ? [body as RosRecord] : [];

/**
 * RouterOS v7 REST API implementation of {@link RouterAdapter}.
 * https://help.mikrotik.com/docs/display/ROS/REST+API
 *
 *   print  → GET    /rest/<path>
 *   get    → GET    /rest/<path>/<id>
 *   add    → PUT    /rest/<path>
 *   set    → PATCH  /rest/<path>/<id>
 *   remove → DELETE /rest/<path>/<id>
 *   cmd    → POST   /rest/<path>/<command>
 */
export class RestRouterAdapter implements RouterAdapter {
  readonly transport = 'REST' as const;
  private readonly agent: http.Agent;
  private readonly auth: string;

  constructor(private readonly opts: RestAdapterOptions) {
    this.agent = opts.tls
      ? new https.Agent({ keepAlive: true, maxSockets: 4, rejectUnauthorized: opts.verifyTls })
      : new http.Agent({ keepAlive: true, maxSockets: 4 });
    this.auth = 'Basic ' + Buffer.from(`${opts.username}:${opts.password}`, 'utf8').toString('base64');
  }

  async print(path: MenuPath, opts: PrintOptions = {}): Promise<RosRecord[]> {
    assertPath(path);
    const qs = new URLSearchParams();
    if (opts.proplist?.length) qs.set('.proplist', opts.proplist.join(','));
    if (opts.where) {
      assertProps(opts.where);
      for (const [k, v] of Object.entries(opts.where)) qs.set(k, v);
    }
    const q = qs.toString();
    return asRows(await this.request('GET', path + (q ? `?${q}` : '')));
  }

  async get(path: MenuPath, id: string): Promise<RosRecord> {
    assertPath(path);
    assertId(id);
    return (await this.request('GET', `${path}/${encodeURIComponent(id)}`)) as RosRecord;
  }

  async add(path: MenuPath, props: RosProps): Promise<string> {
    assertPath(path);
    assertProps(props);
    const created = (await this.request('PUT', path, props)) as RosRecord | undefined;
    return created?.['.id'] ?? '';
  }

  async set(path: MenuPath, id: string, props: RosProps): Promise<void> {
    assertPath(path);
    assertId(id);
    assertProps(props);
    await this.request('PATCH', `${path}/${encodeURIComponent(id)}`, props);
  }

  async remove(path: MenuPath, id: string): Promise<void> {
    assertPath(path);
    assertId(id);
    await this.request('DELETE', `${path}/${encodeURIComponent(id)}`);
  }

  async command(path: MenuPath, command: RosCommand, params: RosProps = {}): Promise<RosRecord[]> {
    assertPath(path);
    assertCommand(command);
    assertProps(params);
    return asRows(await this.request('POST', `${path}/${command}`, params));
  }

  async close(): Promise<void> {
    this.agent.destroy();
  }

  private request(method: string, path: string, body?: unknown): Promise<unknown> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    const lib = this.opts.tls ? https : http;
    const port = this.opts.port ?? (this.opts.tls ? 443 : 80);

    return new Promise((resolve, reject) => {
      const req = lib.request(
        {
          host: this.opts.host,
          port,
          method,
          path: `/rest${path}`,
          agent: this.agent,
          headers: {
            Authorization: this.auth,
            Accept: 'application/json',
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
          },
          timeout: this.opts.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json: unknown;
            try {
              json = text ? JSON.parse(text) : undefined;
            } catch {
              json = undefined;
            }
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 300) return resolve(json);
            const detail =
              (json as { detail?: string; message?: string } | undefined)?.detail ??
              (json as { message?: string } | undefined)?.message ??
              `HTTP ${status}`;
            if (status === 401) return reject(new RouterAuthError('Authentication rejected by router'));
            if (status === 404) return reject(new RouterNotFoundError(detail));
            if (status >= 500 && !json) return reject(new RouterConnectionError(detail));
            reject(new RouterCommandError(detail));
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`timeout after ${this.opts.timeoutMs}ms`)));
      req.on('error', (e) => reject(describeConnectError(this.opts.host, port, this.opts.tls, e)));
      if (payload) req.write(payload);
      req.end();
    });
  }
}
