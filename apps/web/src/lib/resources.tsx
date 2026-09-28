import { Badge } from '@/components/ui/badge';
import type { FieldSpec } from '@/components/resource-form';
import type { ResourceDef } from '@/components/resource-tab';
import { post } from './api';
import type { RosRow } from './types';

/**
 * Router resource screens, declared as data. Field names mirror the API DTOs
 * (apps/api/src/network/network.dto.ts); the API validates everything again.
 */

const PROTOCOLS = ['tcp', 'udp', 'icmp', 'icmpv6', 'gre', 'ipsec-esp', 'ipsec-ah', 'ospf', 'sctp', 'l2tp', 'igmp'];
const COMMON: FieldSpec[] = [
  { name: 'comment', label: 'Comment' },
  { name: 'disabled', label: 'Disabled', type: 'checkbox' },
];
const MATCHERS: FieldSpec[] = [
  { name: 'protocol', label: 'Protocol', type: 'select', options: PROTOCOLS },
  { name: 'srcAddress', label: 'Src. address', placeholder: '10.0.0.0/8 or !192.168.1.5' },
  { name: 'dstAddress', label: 'Dst. address' },
  { name: 'srcPort', label: 'Src. port', placeholder: '1024-65535' },
  { name: 'dstPort', label: 'Dst. port', placeholder: '22,80,443' },
  { name: 'inInterface', label: 'In interface' },
  { name: 'outInterface', label: 'Out interface' },
  { name: 'inInterfaceList', label: 'In interface list', placeholder: 'WAN' },
  { name: 'outInterfaceList', label: 'Out interface list' },
  { name: 'srcAddressList', label: 'Src. address list' },
  { name: 'dstAddressList', label: 'Dst. address list' },
];

const flag = (v: string | undefined, label: string, variant: 'success' | 'secondary' | 'warning' = 'secondary') =>
  v === 'true' ? <Badge variant={variant}>{label}</Badge> : null;

const actionBadge = (a: string) => {
  const variant = ['drop', 'reject', 'tarpit'].includes(a) ? 'destructive' : a === 'accept' ? 'success' : 'secondary';
  return <Badge variant={variant}>{a}</Badge>;
};

const matchSummary = (r: RosRow) =>
  [
    r.protocol && `proto=${r.protocol}`,
    r['src-address'] && `src=${r['src-address']}`,
    r['dst-address'] && `dst=${r['dst-address']}`,
    r['src-port'] && `sport=${r['src-port']}`,
    r['dst-port'] && `dport=${r['dst-port']}`,
    r['in-interface'] && `in=${r['in-interface']}`,
    r['out-interface'] && `out=${r['out-interface']}`,
    r['in-interface-list'] && `in-list=${r['in-interface-list']}`,
    r['out-interface-list'] && `out-list=${r['out-interface-list']}`,
    r['src-address-list'] && `src-list=${r['src-address-list']}`,
    r['dst-address-list'] && `dst-list=${r['dst-address-list']}`,
    r['connection-state'] && `state=${r['connection-state']}`,
  ]
    .filter(Boolean)
    .join(' ') || 'any';

const FILTER_FIELDS: FieldSpec[] = [
  { name: 'chain', label: 'Chain', required: true, placeholder: 'input / forward / output' },
  {
    name: 'action',
    label: 'Action',
    type: 'select',
    required: true,
    options: ['accept', 'drop', 'reject', 'jump', 'return', 'log', 'passthrough', 'tarpit', 'fasttrack-connection', 'add-src-to-address-list', 'add-dst-to-address-list'],
  },
  { name: 'jumpTarget', label: 'Jump target', showIf: { field: 'action', in: ['jump'] } },
  { name: 'addressList', label: 'Address list', showIf: { field: 'action', in: ['add-src-to-address-list', 'add-dst-to-address-list'] } },
  { name: 'addressListTimeout', label: 'List timeout', placeholder: '1d', showIf: { field: 'action', in: ['add-src-to-address-list', 'add-dst-to-address-list'] } },
  { name: 'rejectWith', label: 'Reject with', type: 'select', options: ['icmp-network-unreachable', 'icmp-host-unreachable', 'icmp-port-unreachable', 'icmp-admin-prohibited', 'tcp-reset'], showIf: { field: 'action', in: ['reject'] } },
  { name: 'connectionState', label: 'Connection state', placeholder: 'established,related' },
  ...MATCHERS,
  { name: 'log', label: 'Log', type: 'checkbox' },
  { name: 'logPrefix', label: 'Log prefix' },
  ...COMMON,
  { name: 'placeBefore', label: 'Place before rule id', placeholder: '*3', createOnly: true, help: 'Empty = append at the end' },
];

const NAT_FIELDS: FieldSpec[] = [
  { name: 'chain', label: 'Chain', required: true, placeholder: 'srcnat / dstnat' },
  { name: 'action', label: 'Action', type: 'select', required: true, options: ['masquerade', 'src-nat', 'dst-nat', 'netmap', 'redirect', 'accept', 'return', 'jump', 'passthrough', 'same'] },
  { name: 'toAddresses', label: 'To addresses', showIf: { field: 'action', in: ['src-nat', 'dst-nat', 'netmap', 'same'] } },
  { name: 'toPorts', label: 'To ports', showIf: { field: 'action', in: ['src-nat', 'dst-nat', 'netmap', 'redirect', 'masquerade'] } },
  { name: 'jumpTarget', label: 'Jump target', showIf: { field: 'action', in: ['jump'] } },
  ...MATCHERS,
  { name: 'log', label: 'Log', type: 'checkbox' },
  ...COMMON,
  { name: 'placeBefore', label: 'Place before rule id', placeholder: '*3', createOnly: true },
];

export const RESOURCE_DEFS = {
  interfaces: {
    title: 'Interfaces',
    endpoint: '/interfaces',
    read: 'interface:read',
    write: ['interface:write'],
    canToggle: true,
    columns: [
      { key: 'name', label: 'Name', mono: true },
      { key: 'type', label: 'Type' },
      { key: 'running', label: 'Link', render: (r) => (r.running === 'true' ? <Badge variant="success">up</Badge> : <Badge variant="destructive">down</Badge>) },
      { key: 'mtu', label: 'MTU' },
      { key: 'mac-address', label: 'MAC', mono: true },
      { key: 'comment', label: 'Comment' },
    ],
    editFields: [{ name: 'mtu', label: 'MTU', type: 'number' }, ...COMMON],
  },
  addresses: {
    title: 'IP Addresses',
    endpoint: '/ip/addresses',
    read: 'ip:read',
    write: ['ip:write'],
    canToggle: true,
    canDelete: true,
    columns: [
      { key: 'address', label: 'Address', mono: true },
      { key: 'network', label: 'Network', mono: true },
      { key: 'interface', label: 'Interface' },
      { key: 'dynamic', label: '', render: (r) => flag(r.dynamic, 'dynamic') },
      { key: 'comment', label: 'Comment' },
    ],
    createFields: [
      { name: 'address', label: 'Address/prefix', required: true, placeholder: '192.168.88.1/24' },
      { name: 'interface', label: 'Interface', required: true, placeholder: 'bridge' },
      ...COMMON,
    ],
    editFields: [{ name: 'address', label: 'Address/prefix' }, { name: 'interface', label: 'Interface' }, ...COMMON],
  },
  routes: {
    title: 'Routes',
    endpoint: '/ip/routes',
    read: 'ip:read',
    write: ['ip:write'],
    canToggle: true,
    canDelete: true,
    columns: [
      { key: 'dst-address', label: 'Destination', mono: true },
      { key: 'gateway', label: 'Gateway', mono: true },
      { key: 'distance', label: 'Distance' },
      { key: 'routing-table', label: 'Table' },
      { key: 'active', label: '', render: (r) => <>{flag(r.active, 'active', 'success')} {flag(r.dynamic, 'dynamic')}</> },
      { key: 'comment', label: 'Comment' },
    ],
    createFields: [
      { name: 'dstAddress', label: 'Destination', required: true, placeholder: '0.0.0.0/0' },
      { name: 'gateway', label: 'Gateway', required: true, placeholder: '10.0.0.1 or ether1' },
      { name: 'distance', label: 'Distance', type: 'number', placeholder: '1' },
      { name: 'routingTable', label: 'Routing table (v7)', placeholder: 'main' },
      ...COMMON,
    ],
    editFields: [
      { name: 'gateway', label: 'Gateway' },
      { name: 'distance', label: 'Distance', type: 'number' },
      ...COMMON,
    ],
  },
  filter: {
    title: 'Firewall Filter',
    endpoint: '/firewall/filter',
    read: 'firewall:read',
    write: ['firewall:write'],
    orderable: true,
    canToggle: true,
    canDelete: true,
    columns: [
      { key: 'chain', label: 'Chain' },
      { key: 'action', label: 'Action', render: (r) => actionBadge(r.action) },
      { key: 'match', label: 'Match', render: matchSummary, mono: true },
      { key: 'comment', label: 'Comment' },
    ],
    createFields: FILTER_FIELDS,
    editFields: FILTER_FIELDS,
  },
  nat: {
    title: 'NAT',
    endpoint: '/firewall/nat',
    read: 'firewall:read',
    write: ['firewall:write'],
    orderable: true,
    canToggle: true,
    canDelete: true,
    columns: [
      { key: 'chain', label: 'Chain' },
      { key: 'action', label: 'Action', render: (r) => actionBadge(r.action) },
      { key: 'match', label: 'Match', render: matchSummary, mono: true },
      { key: 'to', label: 'To', mono: true, render: (r) => [r['to-addresses'], r['to-ports']].filter(Boolean).join(':') || '—' },
      { key: 'comment', label: 'Comment' },
    ],
    createFields: NAT_FIELDS,
    editFields: NAT_FIELDS,
  },
  addressList: {
    title: 'Address Lists',
    endpoint: '/firewall/address-list',
    read: 'firewall:read',
    write: ['firewall:write', 'firewall:address-list'],
    canToggle: true,
    canDelete: true,
    columns: [
      { key: 'list', label: 'List' },
      { key: 'address', label: 'Address', mono: true },
      { key: 'timeout', label: 'Timeout' },
      { key: 'dynamic', label: '', render: (r) => flag(r.dynamic, 'dynamic') },
      { key: 'comment', label: 'Comment' },
    ],
    createFields: [
      { name: 'list', label: 'List', required: true, placeholder: 'blocked' },
      { name: 'address', label: 'Address', required: true, placeholder: '203.0.113.7 or 10.0.0.0/24' },
      { name: 'timeout', label: 'Timeout', placeholder: '1d (empty = permanent)' },
      ...COMMON,
    ],
    editFields: [{ name: 'address', label: 'Address' }, { name: 'timeout', label: 'Timeout' }, ...COMMON],
  },
  dhcpServers: {
    title: 'DHCP Servers',
    endpoint: '/dhcp/servers',
    read: 'dhcp:read',
    write: [],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'interface', label: 'Interface' },
      { key: 'address-pool', label: 'Pool' },
      { key: 'lease-time', label: 'Lease time' },
      { key: 'disabled', label: '', render: (r) => flag(r.disabled, 'disabled', 'warning') },
    ],
  },
  dhcpLeases: {
    title: 'DHCP Leases',
    endpoint: '/dhcp/leases',
    read: 'dhcp:read',
    write: ['dhcp:write'],
    canDelete: true,
    canToggle: true,
    columns: [
      { key: 'address', label: 'Address', mono: true },
      { key: 'mac-address', label: 'MAC', mono: true },
      { key: 'host-name', label: 'Host' },
      { key: 'server', label: 'Server' },
      { key: 'status', label: 'Status' },
      { key: 'dynamic', label: '', render: (r) => (r.dynamic === 'true' ? <Badge variant="secondary">dynamic</Badge> : <Badge>static</Badge>) },
      { key: 'comment', label: 'Comment' },
    ],
    createFields: [
      { name: 'address', label: 'IP address', required: true },
      { name: 'macAddress', label: 'MAC address', required: true, placeholder: 'AA:BB:CC:DD:EE:FF' },
      { name: 'server', label: 'Server', placeholder: 'dhcp1' },
      ...COMMON,
    ],
    editFields: [{ name: 'address', label: 'IP address' }, ...COMMON],
    rowActions: [
      {
        label: 'Make static',
        show: (r) => r.dynamic === 'true',
        run: (routerId, r) => post(`/routers/${routerId}/dhcp/leases/${encodeURIComponent(r['.id'])}/make-static`),
      },
    ],
  },
  pppSecrets: {
    title: 'PPP Secrets',
    endpoint: '/ppp/secrets',
    read: 'ppp:read',
    write: ['ppp:write'],
    canToggle: true,
    canDelete: true,
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'service', label: 'Service' },
      { key: 'profile', label: 'Profile' },
      { key: 'remote-address', label: 'Remote address', mono: true },
      { key: 'last-logged-out', label: 'Last logout' },
      { key: 'comment', label: 'Comment' },
    ],
    createFields: [
      { name: 'name', label: 'Username', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true },
      { name: 'service', label: 'Service', type: 'select', options: ['any', 'pppoe', 'pptp', 'l2tp', 'ovpn', 'sstp'] },
      { name: 'profile', label: 'Profile', placeholder: 'default' },
      { name: 'localAddress', label: 'Local address' },
      { name: 'remoteAddress', label: 'Remote address' },
      ...COMMON,
    ],
    editFields: [
      { name: 'password', label: 'New password', type: 'password', help: 'Leave empty to keep the current password' },
      { name: 'service', label: 'Service', type: 'select', options: ['any', 'pppoe', 'pptp', 'l2tp', 'ovpn', 'sstp'] },
      { name: 'profile', label: 'Profile' },
      { name: 'remoteAddress', label: 'Remote address' },
      ...COMMON,
    ],
  },
  pppActive: {
    title: 'Active PPP Sessions',
    endpoint: '/ppp/active',
    read: 'ppp:read',
    write: ['ppp:write'],
    canDelete: true,
    deleteLabel: 'Disconnect',
    columns: [
      { key: 'name', label: 'User' },
      { key: 'service', label: 'Service' },
      { key: 'address', label: 'Address', mono: true },
      { key: 'caller-id', label: 'Caller ID', mono: true },
      { key: 'uptime', label: 'Uptime' },
    ],
  },
  queues: {
    title: 'Simple Queues',
    endpoint: '/queues/simple',
    read: 'queue:read',
    write: ['queue:write'],
    canToggle: true,
    canDelete: true,
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'target', label: 'Target', mono: true },
      { key: 'max-limit', label: 'Max limit (up/down)', mono: true },
      { key: 'limit-at', label: 'Limit at', mono: true },
      { key: 'parent', label: 'Parent' },
      { key: 'comment', label: 'Comment' },
    ],
    createFields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'target', label: 'Target', required: true, placeholder: '192.168.88.0/24' },
      { name: 'maxLimit', label: 'Max limit', placeholder: '10M/50M' },
      { name: 'limitAt', label: 'Limit at', placeholder: '1M/5M' },
      { name: 'parent', label: 'Parent' },
      { name: 'priority', label: 'Priority', placeholder: '8/8' },
      ...COMMON,
    ],
    editFields: [
      { name: 'target', label: 'Target' },
      { name: 'maxLimit', label: 'Max limit' },
      { name: 'limitAt', label: 'Limit at' },
      ...COMMON,
    ],
  },
} satisfies Record<string, ResourceDef>;
