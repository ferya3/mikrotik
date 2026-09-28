import { PERMISSIONS, Permission } from '../common/rbac/permissions';
import type { MenuPath } from '../mikrotik/types';

export interface ResourceSpec {
  /** Stable key used in audit logs (targetType). */
  key: string;
  path: MenuPath;
  /** Prefix for audit actions: <audit>_CREATE / _UPDATE / _DELETE / _MOVE. */
  audit: string;
  read: Permission;
  /** Any of these permissions allows writes. */
  write: Permission[];
}

const P = PERMISSIONS;

export const RESOURCES = {
  interface: { key: 'interface', path: '/interface', audit: 'INTERFACE', read: P.INTERFACE_READ, write: [P.INTERFACE_WRITE] },
  ipAddress: { key: 'ip.address', path: '/ip/address', audit: 'IP_ADDRESS', read: P.IP_READ, write: [P.IP_WRITE] },
  route: { key: 'ip.route', path: '/ip/route', audit: 'ROUTE', read: P.IP_READ, write: [P.IP_WRITE] },
  firewallFilter: {
    key: 'firewall.filter',
    path: '/ip/firewall/filter',
    audit: 'FIREWALL_FILTER',
    read: P.FIREWALL_READ,
    write: [P.FIREWALL_WRITE],
  },
  firewallNat: {
    key: 'firewall.nat',
    path: '/ip/firewall/nat',
    audit: 'FIREWALL_NAT',
    read: P.FIREWALL_READ,
    write: [P.FIREWALL_WRITE],
  },
  addressList: {
    key: 'firewall.address-list',
    path: '/ip/firewall/address-list',
    audit: 'ADDRESS_LIST',
    read: P.FIREWALL_READ,
    write: [P.FIREWALL_WRITE, P.FIREWALL_ADDRESS_LIST],
  },
  dhcpServer: { key: 'dhcp.server', path: '/ip/dhcp-server', audit: 'DHCP_SERVER', read: P.DHCP_READ, write: [P.DHCP_WRITE] },
  dhcpNetwork: {
    key: 'dhcp.network',
    path: '/ip/dhcp-server/network',
    audit: 'DHCP_NETWORK',
    read: P.DHCP_READ,
    write: [P.DHCP_WRITE],
  },
  dhcpLease: {
    key: 'dhcp.lease',
    path: '/ip/dhcp-server/lease',
    audit: 'DHCP_LEASE',
    read: P.DHCP_READ,
    write: [P.DHCP_WRITE],
  },
  pppSecret: { key: 'ppp.secret', path: '/ppp/secret', audit: 'PPP_SECRET', read: P.PPP_READ, write: [P.PPP_WRITE] },
  pppActive: { key: 'ppp.active', path: '/ppp/active', audit: 'PPP_ACTIVE', read: P.PPP_READ, write: [P.PPP_WRITE] },
  pppProfile: { key: 'ppp.profile', path: '/ppp/profile', audit: 'PPP_PROFILE', read: P.PPP_READ, write: [P.PPP_WRITE] },
  simpleQueue: { key: 'queue.simple', path: '/queue/simple', audit: 'QUEUE_SIMPLE', read: P.QUEUE_READ, write: [P.QUEUE_WRITE] },
} satisfies Record<string, ResourceSpec>;

/** Properties never returned to the panel (RouterOS returns PPP passwords in plaintext). */
export const HIDDEN_PROPS: Partial<Record<string, string[]>> = {
  'ppp.secret': ['password'],
};
