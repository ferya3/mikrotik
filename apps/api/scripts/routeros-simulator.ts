/**
 * RouterOS REST simulator for developing the panel without hardware.
 *
 *   npx ts-node apps/api/scripts/routeros-simulator.ts            # :8080, admin / admin
 *   SIM_PORT=8081 SIM_IDENTITY=Branch-01 npx ts-node apps/api/scripts/routeros-simulator.ts
 *
 * Then add a router in the panel: host 127.0.0.1, port 8080, connection REST, TLS off.
 * Implements the subset of /rest used by the platform, with in-memory state and moving counters.
 * It is NOT a RouterOS emulator — validation is minimal.
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';

const PORT = Number(process.env.SIM_PORT ?? 8080);
const USER = process.env.SIM_USER ?? 'admin';
const PASS = process.env.SIM_PASS ?? 'admin';
const IDENTITY = process.env.SIM_IDENTITY ?? 'Sim-Router';
const started = Date.now();

type Row = Record<string, string>;
let seq = 0x10;
const nextId = () => `*${(seq++).toString(16).toUpperCase()}`;

const menus: Record<string, Row[]> = {
  '/interface': ['ether1', 'ether2', 'ether3', 'sfp-sfpplus1', 'bridge', '<pppoe-user1>'].map((name, i) => ({
    '.id': `*${i + 1}`,
    name,
    type: name === 'bridge' ? 'bridge' : name.startsWith('<pppoe') ? 'pppoe-in' : 'ether',
    mtu: '1500',
    running: name === 'ether3' ? 'false' : 'true',
    disabled: 'false',
    comment: name === 'ether1' ? 'WAN' : '',
    'rx-byte': '0',
    'tx-byte': '0',
  })),
  '/ip/address': [{ '.id': '*1', address: '192.168.88.1/24', network: '192.168.88.0', interface: 'bridge', disabled: 'false' }],
  '/ip/route': [{ '.id': '*1', 'dst-address': '0.0.0.0/0', gateway: '10.0.0.254', distance: '1', active: 'true', disabled: 'false' }],
  '/ip/firewall/filter': [
    { '.id': '*1', chain: 'input', action: 'accept', 'connection-state': 'established,related', disabled: 'false', comment: 'accept established' },
    { '.id': '*2', chain: 'input', action: 'drop', 'in-interface': 'ether1', disabled: 'false', comment: 'drop WAN' },
  ],
  '/ip/firewall/nat': [{ '.id': '*1', chain: 'srcnat', action: 'masquerade', 'out-interface': 'ether1', disabled: 'false' }],
  '/ip/firewall/address-list': [{ '.id': '*1', list: 'blocked', address: '203.0.113.7', disabled: 'false', dynamic: 'false' }],
  '/ip/dhcp-server': [{ '.id': '*1', name: 'dhcp1', interface: 'bridge', 'address-pool': 'pool1', disabled: 'false' }],
  '/ip/dhcp-server/network': [{ '.id': '*1', address: '192.168.88.0/24', gateway: '192.168.88.1', 'dns-server': '192.168.88.1' }],
  '/ip/dhcp-server/lease': [
    { '.id': '*1', address: '192.168.88.10', 'mac-address': 'AA:BB:CC:00:11:22', 'host-name': 'laptop', server: 'dhcp1', status: 'bound', dynamic: 'true', disabled: 'false' },
    { '.id': '*2', address: '192.168.88.23', 'mac-address': 'AA:BB:CC:00:11:23', 'host-name': 'torrent-box', server: 'dhcp1', status: 'bound', dynamic: 'true', disabled: 'false' },
    { '.id': '*3', address: '192.168.88.31', 'mac-address': 'AA:BB:CC:00:11:31', 'host-name': 'phone-sara', server: 'dhcp1', status: 'bound', dynamic: 'true', disabled: 'false' },
  ],
  '/ip/arp': [
    { '.id': '*1', address: '192.168.88.10', 'mac-address': 'AA:BB:CC:00:11:22', interface: 'bridge', dynamic: 'true', complete: 'true' },
    { '.id': '*2', address: '192.168.88.23', 'mac-address': 'AA:BB:CC:00:11:23', interface: 'bridge', dynamic: 'true', complete: 'true' },
    { '.id': '*3', address: '192.168.88.31', 'mac-address': 'AA:BB:CC:00:11:31', interface: 'bridge', dynamic: 'true', complete: 'true' },
    { '.id': '*4', address: '192.168.88.40', 'mac-address': 'AA:BB:CC:00:11:40', interface: 'bridge', dynamic: 'true', complete: 'true' },
    { '.id': '*5', address: '10.0.0.254', 'mac-address': 'DE:AD:BE:EF:00:01', interface: 'ether1', dynamic: 'true', complete: 'true' },
  ],
  '/ip/hotspot/active': [],
  '/ip/firewall/connection': Array.from({ length: 12 }, (_, i) => ({
    '.id': `*C${i}`,
    'src-address': `192.168.88.${i < 8 ? 23 : 10}:${40000 + i}`,
    'dst-address': `203.0.113.${i}:443`,
    protocol: 'tcp',
  })),
  '/ppp/secret': [{ '.id': '*1', name: 'user1', password: 'secret', service: 'pppoe', profile: 'default', disabled: 'false' }],
  '/ppp/active': [{ '.id': '*1', name: 'user1', service: 'pppoe', address: '10.10.0.2', uptime: '1h2m3s', 'caller-id': 'AA:BB:CC:00:00:01' }],
  '/ppp/profile': [{ '.id': '*0', name: 'default' }],
  '/queue/simple': [
    { '.id': '*2', name: 'nms-192.168.88.10', target: '192.168.88.10/32', 'max-limit': '0/0', disabled: 'false', dynamic: 'false', rate: '0/0', bytes: '0/0' },
    { '.id': '*3', name: 'torrent', target: '192.168.88.23/32', 'max-limit': '0/0', disabled: 'false', dynamic: 'false', rate: '0/0', bytes: '0/0' },
    { '.id': '*1', name: 'guest', target: '192.168.88.0/24', 'max-limit': '10M/20M', disabled: 'false', dynamic: 'false', rate: '0/0', bytes: '0/0' },
  ],
  '/log': Array.from({ length: 20 }, (_, i) => ({
    '.id': `*${i + 1}`,
    time: `09:${String(i).padStart(2, '0')}:00`,
    topics: i % 3 ? 'system,info' : 'firewall,info',
    message: i % 3 ? `user admin logged in via api` : `input: in:ether1 proto TCP (SYN) 198.51.100.${i}:5000->10.0.0.1:22`,
  })),
};

function singleton(path: string): Row | null {
  const up = Math.floor((Date.now() - started) / 1000);
  switch (path) {
    case '/system/resource':
      return {
        uptime: `${Math.floor(up / 3600)}h${Math.floor((up % 3600) / 60)}m${up % 60}s`,
        version: '7.16.1 (stable)',
        'board-name': 'CCR2004-1G-12S+2XS',
        'architecture-name': 'arm64',
        cpu: 'ARM64',
        'cpu-count': '4',
        'cpu-load': String(10 + Math.floor(Math.random() * 40)),
        'free-memory': String(3_000_000_000 - Math.floor(Math.random() * 200_000_000)),
        'total-memory': '4294967296',
        'free-hdd-space': '100000000',
        'total-hdd-space': '134217728',
      };
    case '/system/identity':
      return { name: IDENTITY };
    case '/system/routerboard':
      return { routerboard: 'true', model: 'CCR2004-1G-12S+2XS', 'serial-number': 'SIM0000001' };
    default:
      return null;
  }
}

/** Per-host traffic profile (bps down/up) — 192.168.88.23 is the heavy downloader. */
const HOST_PROFILE: Record<string, [number, number]> = {
  '192.168.88.10': [3_000_000, 400_000],
  '192.168.88.23': [85_000_000, 2_000_000],
};
let lastQueueTick = Date.now();

function tickQueues() {
  const now = Date.now();
  const dt = Math.max(0.001, (now - lastQueueTick) / 1000);
  lastQueueTick = now;
  for (const q of menus['/queue/simple']) {
    const host = q.target?.replace(/\/32$/, '');
    const [down, up] = HOST_PROFILE[host] ?? [0, 0];
    const [maxUp, maxDown] = (q['max-limit'] ?? '0/0').split('/').map((v) => {
      const m = /^(\d+(?:\.\d+)?)([kMG]?)$/.exec(v);
      return m ? Number(m[1]) * ({ '': 1, k: 1e3, M: 1e6, G: 1e9 }[m[2]] ?? 1) : 0;
    });
    const blocked = menus['/ip/firewall/address-list'].some((e) => e.list === 'nms-blocked' && e.address === host);
    const jitter = () => 0.8 + Math.random() * 0.4;
    const d = blocked ? 0 : Math.min(down * jitter(), maxDown || Infinity);
    const u = blocked ? 0 : Math.min(up * jitter(), maxUp || Infinity);
    const [bu, bd] = (q.bytes ?? '0/0').split('/').map(Number);
    q.rate = `${Math.round(u)}/${Math.round(d)}`;
    q.bytes = `${Math.round(bu + (u * dt) / 8)}/${Math.round(bd + (d * dt) / 8)}`;
  }
}

function tickCounters() {
  for (const i of menus['/interface']) {
    if (i.running !== 'true' || i.disabled === 'true') continue;
    i['rx-byte'] = String(Number(i['rx-byte']) + Math.floor(Math.random() * 50_000_000));
    i['tx-byte'] = String(Number(i['tx-byte']) + Math.floor(Math.random() * 20_000_000));
  }
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

const readBody = (req: IncomingMessage) =>
  new Promise<Row>((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });

createServer(async (req, res) => {
  const auth = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
  if (auth !== `${USER}:${PASS}`) return send(res, 401, { error: 401, message: 'Unauthorized' });

  const url = new URL(req.url ?? '/', 'http://sim');
  if (!url.pathname.startsWith('/rest/')) return send(res, 404, { error: 404, message: 'Not Found' });
  let path = url.pathname.slice(5);
  let id: string | undefined;
  let command: string | undefined;
  const last = path.split('/').pop()!;
  if (last.startsWith('*') || last.startsWith('%2A')) {
    id = decodeURIComponent(last);
    path = path.slice(0, -last.length - 1);
  } else if (req.method === 'POST') {
    command = last;
    path = path.slice(0, -last.length - 1);
  }

  const one = singleton(path);
  if (one && req.method === 'GET') return send(res, 200, one);
  if (path === '/system/health') return send(res, 200, [{ '.id': '*1', name: 'cpu-temperature', value: String(45 + Math.floor(Math.random() * 10)), type: 'C' }]);
  if (path === '/system' && command === 'reboot') return send(res, 200, []);

  const rows = menus[path];
  if (!rows) return send(res, 400, { error: 400, message: 'Bad Request', detail: 'no such command' });
  if (path === '/interface') tickCounters();
  if (path === '/queue/simple') tickQueues();

  switch (req.method) {
    case 'GET': {
      if (id) {
        const row = rows.find((r) => r['.id'] === id);
        return row ? send(res, 200, row) : send(res, 404, { error: 404, message: 'Not Found', detail: 'no such item' });
      }
      const proplist = url.searchParams.get('.proplist')?.split(',');
      const filters = [...url.searchParams.entries()].filter(([k]) => k !== '.proplist');
      const out = rows
        .filter((r) => filters.every(([k, v]) => r[k] === v))
        .map((r) => (proplist ? Object.fromEntries(proplist.map((p) => [p, r[p]])) : r));
      return send(res, 200, out);
    }
    case 'PUT': {
      const body = await readBody(req);
      const { 'place-before': before, ...props } = body;
      const row: Row = { '.id': nextId(), disabled: 'false' };
      for (const [k, v] of Object.entries(props)) row[k] = v === 'yes' ? 'true' : v === 'no' ? 'false' : v;
      const idx = before ? rows.findIndex((r) => r['.id'] === before) : -1;
      if (idx >= 0) rows.splice(idx, 0, row);
      else rows.push(row);
      return send(res, 201, row);
    }
    case 'PATCH': {
      const row = rows.find((r) => r['.id'] === id);
      if (!row) return send(res, 404, { error: 404, message: 'Not Found', detail: 'no such item' });
      const body = await readBody(req);
      for (const [k, v] of Object.entries(body)) row[k] = v === 'yes' ? 'true' : v === 'no' ? 'false' : v;
      return send(res, 200, row);
    }
    case 'DELETE': {
      const idx = rows.findIndex((r) => r['.id'] === id);
      if (idx < 0) return send(res, 404, { error: 404, message: 'Not Found', detail: 'no such item' });
      rows.splice(idx, 1);
      return send(res, 204);
    }
    case 'POST': {
      const body = await readBody(req);
      if (command === 'move') {
        const from = rows.findIndex((r) => r['.id'] === body.numbers);
        if (from < 0) return send(res, 400, { error: 400, message: 'Bad Request', detail: 'no such item' });
        const [row] = rows.splice(from, 1);
        const to = rows.findIndex((r) => r['.id'] === body.destination);
        rows.splice(to < 0 ? rows.length : to, 0, row);
        return send(res, 200, []);
      }
      if (command === 'unset') {
        const row = rows.find((r) => r['.id'] === body.numbers);
        if (row) delete row[body['value-name']];
        return send(res, 200, []);
      }
      if (command === 'make-static') {
        const row = rows.find((r) => r['.id'] === body.numbers);
        if (row) row.dynamic = 'false';
        return send(res, 200, []);
      }
      return send(res, 400, { error: 400, message: 'Bad Request', detail: 'no such command' });
    }
  }
  send(res, 405, { error: 405, message: 'Method Not Allowed' });
}).listen(PORT, () => console.log(`RouterOS REST simulator "${IDENTITY}" on :${PORT} (${USER}/${PASS})`));
