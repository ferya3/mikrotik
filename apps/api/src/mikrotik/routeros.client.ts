import { RouterCommandError } from './errors';
import type { MenuPath, RosProps, RosRecord, RouterAdapter } from './types';

export interface SystemResource {
  uptime: string;
  version: string;
  boardName: string;
  architecture: string;
  cpu: string;
  cpuCount: number;
  cpuLoad: number;
  freeMemory: number;
  totalMemory: number;
  freeHdd: number;
  totalHdd: number;
}

const num = (v: string | undefined) => (v === undefined || v === '' ? 0 : Number(v));

/** Parses RouterOS durations such as "1w2d03:04:05", "3d4h5m6s" or "00:01:02" into seconds. */
export function parseRosDuration(s: string | undefined): number {
  if (!s) return 0;
  let total = 0;
  const units: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let rest = s.trim();
  const clock = /(\d+):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(rest);
  if (clock) {
    total += Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    rest = rest.slice(0, clock.index);
  }
  for (const m of rest.matchAll(/(\d+)(w|d|h|m|s)(?!s)/g)) total += Number(m[1]) * units[m[2]];
  return total;
}

/**
 * Typed facade over a {@link RouterAdapter}. This is the API the rest of the application uses;
 * it knows RouterOS semantics (menus, property names) but nothing about the transport.
 */
export class RouterOsClient {
  constructor(readonly adapter: RouterAdapter) {}

  // ── System ────────────────────────────────────────────
  async getSystemResource(): Promise<SystemResource> {
    const [r] = await this.adapter.print('/system/resource');
    return {
      uptime: r.uptime,
      version: r.version,
      boardName: r['board-name'],
      architecture: r['architecture-name'],
      cpu: r.cpu,
      cpuCount: num(r['cpu-count']),
      cpuLoad: num(r['cpu-load']),
      freeMemory: num(r['free-memory']),
      totalMemory: num(r['total-memory']),
      freeHdd: num(r['free-hdd-space']),
      totalHdd: num(r['total-hdd-space']),
    };
  }

  async getIdentity(): Promise<string> {
    const [r] = await this.adapter.print('/system/identity');
    return r?.name ?? '';
  }

  /** Not present on CHR / x86 — returns null instead of failing. */
  async getRouterboard(): Promise<RosRecord | null> {
    try {
      const [r] = await this.adapter.print('/system/routerboard');
      return r ?? null;
    } catch (e) {
      if (e instanceof RouterCommandError) return null;
      throw e;
    }
  }

  /** Temperature / voltage where the hardware exposes it. v6 returns one row of props, v7 one row per sensor. */
  async getTemperature(): Promise<number | null> {
    try {
      const rows = await this.adapter.print('/system/health');
      for (const r of rows) {
        if (r.temperature) return Number(r.temperature);
        if (r.name && /temperature/.test(r.name) && r.value) return Number(r.value);
      }
      return null;
    } catch {
      return null;
    }
  }

  reboot(): Promise<RosRecord[]> {
    return this.adapter.command('/system', 'reboot');
  }

  // ── Generic CRUD used by the network module ───────────
  list(path: MenuPath, where?: Record<string, string>): Promise<RosRecord[]> {
    return this.adapter.print(path, { where });
  }

  get(path: MenuPath, id: string): Promise<RosRecord> {
    return this.adapter.get(path, id);
  }

  add(path: MenuPath, props: RosProps): Promise<string> {
    return this.adapter.add(path, props);
  }

  set(path: MenuPath, id: string, props: RosProps): Promise<void> {
    return this.adapter.set(path, id, props);
  }

  remove(path: MenuPath, id: string): Promise<void> {
    return this.adapter.remove(path, id);
  }

  /** Moves rule `id` before rule `beforeId` (firewall, NAT, queues). */
  async move(path: MenuPath, id: string, beforeId: string): Promise<void> {
    await this.adapter.command(path, 'move', { numbers: id, destination: beforeId });
  }

  async makeStaticLease(id: string): Promise<void> {
    await this.adapter.command('/ip/dhcp-server/lease', 'make-static', { numbers: id });
  }

  // ── Monitoring helpers ────────────────────────────────
  listInterfaces(): Promise<RosRecord[]> {
    return this.adapter.print('/interface');
  }

  /** Most recent `limit` log lines (RouterOS keeps a ring buffer in memory). */
  async logs(limit: number, topic?: string): Promise<RosRecord[]> {
    const rows = await this.adapter.print('/log');
    const filtered = topic ? rows.filter((r) => r.topics?.split(',').includes(topic)) : rows;
    return filtered.slice(-limit).reverse();
  }
}
