import type { RosRecord } from '../mikrotik/types';

/**
 * Pure functions that turn raw RouterOS tables into a list of network clients (end users)
 * with their live usage, limits and block state. Kept free of I/O so they are unit-testable.
 *
 * RouterOS direction conventions used throughout:
 *   simple queue  max-limit / rate / bytes  = "upload/download"   (upload = traffic *from* the target)
 *   PPP rate-limit                          = "rx/tx" seen from the router = "upload/download"
 *   dynamic <pppoe-user> interface          rx = client upload, tx = client download
 *   hotspot active                          bytes-in = client upload, bytes-out = client download
 */

export const BLOCK_LIST = 'nms-blocked';
export const MANAGED_QUEUE_PREFIX = 'nms-';
export const BLOCK_RULE_COMMENTS = { src: 'nms:block-src', dst: 'nms:block-dst' } as const;

export type ClientType = 'dhcp' | 'ppp' | 'hotspot' | 'static';

export interface ClientLimit {
  /** bits per second */
  download: number;
  upload: number;
  source: 'queue' | 'ppp';
  queueId?: string;
  queueName?: string;
  /** Queue created by this platform (nms-<ip>) — safe to edit/remove. */
  managed: boolean;
}

export interface NetworkClient {
  key: string;
  type: ClientType;
  address: string | null;
  mac: string | null;
  name: string | null;
  comment: string | null;
  interface: string | null;
  online: boolean;
  pppUser: string | null;
  pppService: string | null;
  uptime: string | null;
  downloadBps: number | null;
  uploadBps: number | null;
  /** Byte counters on the router for the current session / queue lifetime. */
  sessionDownloadBytes: number | null;
  sessionUploadBytes: number | null;
  limit: ClientLimit | null;
  /** Has a counter source (queue or PPP interface) so daily usage is accumulated. */
  tracked: boolean;
  /** The simple queue that applies to this client, if any (limited or not). */
  queueName: string | null;
  blocked: boolean;
  blockReason: string | null;
  blockTimeout: string | null;
  staticLease: boolean;
}

/** "10M" → 10000000, "512k" → 512000, "1.5G" → 1500000000, "123" → 123. */
export function parseRate(v: string | undefined): number {
  if (!v) return 0;
  const m = /^(\d+(?:\.\d+)?)([kKMG]?)$/.exec(v.trim());
  if (!m) return 0;
  const mult = { '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 }[m[2]] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

/** "up/down" → [up, down] */
export function parsePair(v: string | undefined): [number, number] {
  const [a, b] = (v ?? '').split('/');
  return [parseRate(a), parseRate(b)];
}

const isTrue = (v: string | undefined) => v === 'true' || v === 'yes';

/** The single host a queue targets ("10.0.0.5/32" → "10.0.0.5"), or null for subnets / lists / interfaces. */
export function singleHostTarget(target: string | undefined): string | null {
  if (!target || target.includes(',')) return null;
  const m = /^([0-9.]+)(?:\/32)?$|^([0-9a-fA-F:]+)(?:\/128)?$/.exec(target.trim());
  return m ? (m[1] ?? m[2]) : null;
}

export const pppInterfaceName = (service: string | undefined, user: string) => `<${service || 'pppoe'}-${user}>`;

export const managedQueueName = (address: string) => `${MANAGED_QUEUE_PREFIX}${address}`;

export interface RouterTables {
  leases: RosRecord[];
  arp: RosRecord[];
  pppActive: RosRecord[];
  pppSecrets: RosRecord[];
  hotspotActive: RosRecord[];
  queues: RosRecord[];
  interfaces: RosRecord[];
  addressList: RosRecord[];
  dhcpServers: RosRecord[];
  /** Live per-interface rates from the poller (bps), keyed by interface name. */
  liveInterfaceRates?: Map<string, { rxBps: number; txBps: number }>;
}

function emptyClient(key: string, type: ClientType): NetworkClient {
  return {
    key,
    type,
    address: null,
    mac: null,
    name: null,
    comment: null,
    interface: null,
    online: false,
    pppUser: null,
    pppService: null,
    uptime: null,
    downloadBps: null,
    uploadBps: null,
    sessionDownloadBytes: null,
    sessionUploadBytes: null,
    limit: null,
    tracked: false,
    queueName: null,
    blocked: false,
    blockReason: null,
    blockTimeout: null,
    staticLease: false,
  };
}

export function mergeClients(t: RouterTables): NetworkClient[] {
  const clients = new Map<string, NetworkClient>();
  const byIp = (ip: string, type: ClientType) => {
    const key = `ip:${ip}`;
    let c = clients.get(key);
    if (!c) {
      c = { ...emptyClient(key, type), address: ip };
      clients.set(key, c);
    }
    return c;
  };

  // 1. DHCP leases (the richest source: MAC + host name).
  for (const l of t.leases) {
    if (!l.address || isTrue(l.disabled)) continue;
    const bound = l.status === 'bound';
    const isStatic = !isTrue(l.dynamic);
    if (!bound && !isStatic) continue;
    const c = byIp(l.address, 'dhcp');
    c.mac = l['mac-address'] || c.mac;
    c.name = l['host-name'] || c.name;
    c.comment = l.comment || c.comment;
    c.online = c.online || bound;
    c.staticLease = isStatic;
  }

  // 2. ARP neighbours on LAN (DHCP-served) interfaces: devices with static IPs.
  const lanIfaces = new Set(t.dhcpServers.map((s) => s.interface).filter(Boolean));
  for (const a of t.arp) {
    if (!a.address || !a['mac-address']) continue;
    const known = clients.get(`ip:${a.address}`);
    if (!known && !lanIfaces.has(a.interface)) continue;
    const c = known ?? byIp(a.address, 'static');
    c.mac = c.mac ?? a['mac-address'];
    c.interface = a.interface || c.interface;
    if (isTrue(a.complete) || a.status === 'reachable' || a.status === 'stale') c.online = true;
  }

  // 3. Hotspot sessions.
  for (const h of t.hotspotActive) {
    if (!h.address) continue;
    const c = byIp(h.address, 'hotspot');
    c.type = 'hotspot';
    c.name = h.user || c.name;
    c.mac = h['mac-address'] || c.mac;
    c.uptime = h.uptime || null;
    c.online = true;
    c.sessionUploadBytes = Number(h['bytes-in'] ?? 0);
    c.sessionDownloadBytes = Number(h['bytes-out'] ?? 0);
  }

  // 4. Simple queues targeting exactly one host: live rate, counters and limit.
  //    RouterOS applies the first matching queue, so only the first one per host counts.
  const pppQueues = new Map<string, RosRecord>();
  for (const q of t.queues) {
    if (isTrue(q.disabled)) continue;
    const host = singleHostTarget(q.target);
    if (!host) {
      // Dynamic PPP queues target the session interface, e.g. "<pppoe-ali>".
      if (q.target?.startsWith('<') && !pppQueues.has(q.target)) pppQueues.set(q.target, q);
      continue;
    }
    const c = clients.get(`ip:${host}`) ?? byIp(host, 'static');
    if (c.limit || c.tracked) continue;
    applyQueue(c, q);
  }

  // 5. PPP sessions — keyed by user name because the address can change per session.
  const secrets = new Map(t.pppSecrets.map((s) => [s.name, s]));
  const ifaceBytes = new Map(t.interfaces.map((i) => [i.name, i]));
  for (const p of t.pppActive) {
    if (!p.name) continue;
    const key = `ppp:${p.name}`;
    const c = clients.get(key) ?? { ...emptyClient(key, 'ppp') };
    clients.set(key, c);
    // A PPP address is owned by the session; drop any IP-keyed duplicate.
    if (p.address) clients.delete(`ip:${p.address}`);
    const iface = pppInterfaceName(p.service, p.name);
    Object.assign(c, {
      address: p.address || null,
      mac: p['caller-id'] || null,
      name: p.name,
      pppUser: p.name,
      pppService: p.service || null,
      uptime: p.uptime || null,
      online: true,
      interface: iface,
      comment: secrets.get(p.name)?.comment || null,
      tracked: true,
    });
    const counters = ifaceBytes.get(iface);
    if (counters) {
      c.sessionUploadBytes = Number(counters['rx-byte'] ?? 0);
      c.sessionDownloadBytes = Number(counters['tx-byte'] ?? 0);
    }
    const q = pppQueues.get(iface);
    if (q) {
      applyQueue(c, q);
      c.limit = c.limit ? { ...c.limit, source: 'ppp', managed: false } : null;
    } else {
      const live = t.liveInterfaceRates?.get(iface);
      if (live) {
        c.uploadBps = live.rxBps;
        c.downloadBps = live.txBps;
      }
      const rl = secrets.get(p.name)?.['rate-limit'];
      if (rl) {
        const [up, down] = parsePair(rl.split(' ')[0]);
        if (up || down) c.limit = { upload: up, download: down, source: 'ppp', managed: true };
      }
    }
  }

  // 6. PPP secrets that are disabled count as blocked users (even while offline).
  for (const s of t.pppSecrets) {
    if (!isTrue(s.disabled) || !s.name) continue;
    const key = `ppp:${s.name}`;
    const c = clients.get(key) ?? { ...emptyClient(key, 'ppp'), name: s.name, pppUser: s.name, comment: s.comment || null };
    c.blocked = true;
    c.blockReason = s.comment || 'PPP account disabled';
    clients.set(key, c);
  }

  // 7. Address-list blocks.
  for (const e of t.addressList) {
    if (e.list !== BLOCK_LIST || isTrue(e.disabled) || !e.address) continue;
    const ip = e.address.replace(/\/32$/, '');
    const c = [...clients.values()].find((x) => x.address === ip) ?? byIp(ip, 'static');
    c.blocked = true;
    c.blockReason = e.comment || null;
    c.blockTimeout = e.timeout || null;
  }

  return [...clients.values()].sort(
    (a, b) =>
      (b.downloadBps ?? -1) - (a.downloadBps ?? -1) ||
      Number(b.online) - Number(a.online) ||
      (a.address ?? a.name ?? '').localeCompare(b.address ?? b.name ?? '', undefined, { numeric: true }),
  );
}

function applyQueue(c: NetworkClient, q: RosRecord) {
  const [upRate, downRate] = parsePair(q.rate);
  const [upBytes, downBytes] = parsePair(q.bytes);
  const [upMax, downMax] = parsePair(q['max-limit']);
  c.uploadBps = upRate;
  c.downloadBps = downRate;
  c.sessionUploadBytes = upBytes;
  c.sessionDownloadBytes = downBytes;
  c.tracked = true;
  c.queueName = q.name ?? null;
  if (upMax || downMax) {
    c.limit = {
      upload: upMax,
      download: downMax,
      source: 'queue',
      queueId: q['.id'],
      queueName: q.name,
      managed: q.name?.startsWith(MANAGED_QUEUE_PREFIX) ?? false,
    };
  }
}

// ── Usage accounting ─────────────────────────────────────────────────────────

export interface UsageCounter {
  up: number;
  down: number;
  label?: string;
}

/** Current byte counters per client key from one poll (queues for IP clients, interfaces for PPP). */
export function usageCounters(queues: RosRecord[], pppActive: RosRecord[], interfaces: RosRecord[]): Map<string, UsageCounter> {
  const out = new Map<string, UsageCounter>();
  for (const q of queues) {
    if (isTrue(q.dynamic) || isTrue(q.disabled)) continue;
    const host = singleHostTarget(q.target);
    if (!host || out.has(`ip:${host}`)) continue;
    const [up, down] = parsePair(q.bytes);
    out.set(`ip:${host}`, { up, down });
  }
  const ifaces = new Map(interfaces.map((i) => [i.name, i]));
  for (const p of pppActive) {
    const i = p.name ? ifaces.get(pppInterfaceName(p.service, p.name)) : undefined;
    if (!i) continue;
    out.set(`ppp:${p.name}`, { up: Number(i['rx-byte'] ?? 0), down: Number(i['tx-byte'] ?? 0), label: p.name });
  }
  return out;
}

/**
 * Bytes transferred since the previous poll. A counter that went backwards was reset
 * (reboot, reconnect, queue re-created): everything counted since the reset is new traffic.
 * Clients seen for the first time produce no delta (their history before we watched is unknown).
 */
export function usageDeltas(prev: Map<string, UsageCounter> | undefined, cur: Map<string, UsageCounter>) {
  const out = new Map<string, UsageCounter>();
  if (!prev) return out;
  for (const [key, c] of cur) {
    const p = prev.get(key);
    if (!p) continue;
    const up = c.up >= p.up ? c.up - p.up : c.up;
    const down = c.down >= p.down ? c.down - p.down : c.down;
    if (up > 0 || down > 0) out.set(key, { up, down, label: c.label });
  }
  return out;
}
