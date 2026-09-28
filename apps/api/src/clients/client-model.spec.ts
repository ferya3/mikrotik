import { mergeClients, parsePair, parseRate, RouterTables, singleHostTarget, usageCounters, usageDeltas } from './client-model';

const base: RouterTables = {
  leases: [],
  arp: [],
  pppActive: [],
  pppSecrets: [],
  hotspotActive: [],
  queues: [],
  interfaces: [],
  addressList: [],
  dhcpServers: [{ name: 'dhcp1', interface: 'bridge' }],
};

describe('client model', () => {
  it('parses RouterOS rates', () => {
    expect(parseRate('10M')).toBe(10_000_000);
    expect(parseRate('512k')).toBe(512_000);
    expect(parseRate('1.5G')).toBe(1_500_000_000);
    expect(parseRate('2000')).toBe(2000);
    expect(parsePair('1M/10M')).toEqual([1_000_000, 10_000_000]);
    expect(parsePair('0/0')).toEqual([0, 0]);
  });

  it('recognises single-host queue targets only', () => {
    expect(singleHostTarget('192.168.88.10/32')).toBe('192.168.88.10');
    expect(singleHostTarget('192.168.88.10')).toBe('192.168.88.10');
    expect(singleHostTarget('192.168.88.0/24')).toBeNull();
    expect(singleHostTarget('10.0.0.1/32,10.0.0.2/32')).toBeNull();
    expect(singleHostTarget('<pppoe-ali>')).toBeNull();
  });

  it('merges leases, ARP, queues and blocks; sorts heaviest downloader first', () => {
    const clients = mergeClients({
      ...base,
      leases: [
        { '.id': '*1', address: '192.168.88.10', 'mac-address': 'AA:00:00:00:00:10', 'host-name': 'laptop', status: 'bound', dynamic: 'true' },
        { '.id': '*2', address: '192.168.88.11', 'mac-address': 'AA:00:00:00:00:11', 'host-name': 'tv', status: 'bound', dynamic: 'false' },
        { '.id': '*3', address: '192.168.88.99', status: 'waiting', dynamic: 'true' },
      ],
      arp: [
        { address: '192.168.88.50', 'mac-address': 'AA:00:00:00:00:50', interface: 'bridge', complete: 'true' },
        { address: '10.0.0.254', 'mac-address': 'BB:00:00:00:00:01', interface: 'ether1', complete: 'true' }, // upstream gateway
      ],
      queues: [
        { '.id': '*A', name: 'nms-192.168.88.11', target: '192.168.88.11/32', 'max-limit': '1M/5M', rate: '20000/4800000', bytes: '100/9000' },
        { '.id': '*B', name: 'guest', target: '192.168.88.0/24', 'max-limit': '10M/20M', rate: '0/0', bytes: '0/0' },
      ],
      addressList: [{ list: 'nms-blocked', address: '192.168.88.50', comment: 'torrent', timeout: '59m' }],
    });

    expect(clients.map((c) => c.address)).toEqual(['192.168.88.11', '192.168.88.10', '192.168.88.50']);
    const tv = clients[0];
    expect(tv).toMatchObject({ name: 'tv', type: 'dhcp', downloadBps: 4_800_000, uploadBps: 20_000, tracked: true, staticLease: true });
    expect(tv.limit).toMatchObject({ download: 5_000_000, upload: 1_000_000, managed: true, queueId: '*A' });
    expect(clients[2]).toMatchObject({ type: 'static', blocked: true, blockReason: 'torrent', blockTimeout: '59m' });
    expect(clients.find((c) => c.address === '10.0.0.254')).toBeUndefined();
  });

  it('keys PPP clients by user, uses the session interface and secret state', () => {
    const clients = mergeClients({
      ...base,
      pppActive: [{ '.id': '*1', name: 'ali', service: 'pppoe', address: '10.10.0.2', uptime: '1h', 'caller-id': 'CC:00:00:00:00:01' }],
      pppSecrets: [
        { name: 'ali', 'rate-limit': '2M/10M', disabled: 'false' },
        { name: 'reza', disabled: 'true', comment: 'unpaid' },
      ],
      interfaces: [{ name: '<pppoe-ali>', 'rx-byte': '500', 'tx-byte': '7000' }],
      liveInterfaceRates: new Map([['<pppoe-ali>', { rxBps: 100_000, txBps: 8_000_000 }]]),
      leases: [{ address: '10.10.0.2', status: 'bound', dynamic: 'true' }],
    });
    const ali = clients.find((c) => c.key === 'ppp:ali')!;
    expect(ali).toMatchObject({
      address: '10.10.0.2',
      downloadBps: 8_000_000,
      uploadBps: 100_000,
      sessionDownloadBytes: 7000,
      sessionUploadBytes: 500,
      tracked: true,
    });
    expect(ali.limit).toMatchObject({ download: 10_000_000, upload: 2_000_000, source: 'ppp' });
    expect(clients.find((c) => c.key === 'ip:10.10.0.2')).toBeUndefined();
    expect(clients.find((c) => c.key === 'ppp:reza')).toMatchObject({ blocked: true, blockReason: 'unpaid', online: false });
  });

  it('computes usage deltas and handles counter resets', () => {
    const t0 = usageCounters(
      [{ target: '192.168.88.10/32', bytes: '1000/5000' }],
      [{ name: 'ali', service: 'pppoe' }],
      [{ name: '<pppoe-ali>', 'rx-byte': '10', 'tx-byte': '100' }],
    );
    expect(usageDeltas(undefined, t0).size).toBe(0);
    const t1 = usageCounters(
      [{ target: '192.168.88.10/32', bytes: '1500/9000' }],
      [{ name: 'ali', service: 'pppoe' }],
      [{ name: '<pppoe-ali>', 'rx-byte': '4', 'tx-byte': '40' }], // reconnected → counters reset
    );
    const d = usageDeltas(t0, t1);
    expect(d.get('ip:192.168.88.10')).toMatchObject({ up: 500, down: 4000 });
    expect(d.get('ppp:ali')).toMatchObject({ up: 4, down: 40 });
  });
});
