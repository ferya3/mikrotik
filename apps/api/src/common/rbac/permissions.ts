/**
 * Permission catalogue. Every protected endpoint declares one of these with @RequirePermissions;
 * the backend enforces them — the UI only hides what the user cannot do.
 */
export const PERMISSIONS = {
  ROUTER_READ: 'router:read',
  ROUTER_WRITE: 'router:write',
  ROUTER_DELETE: 'router:delete',
  INTERFACE_READ: 'interface:read',
  INTERFACE_WRITE: 'interface:write',
  IP_READ: 'ip:read',
  IP_WRITE: 'ip:write',
  FIREWALL_READ: 'firewall:read',
  FIREWALL_WRITE: 'firewall:write',
  /** Limited firewall access: address lists only (used by the Operator role). */
  FIREWALL_ADDRESS_LIST: 'firewall:address-list',
  DHCP_READ: 'dhcp:read',
  DHCP_WRITE: 'dhcp:write',
  PPP_READ: 'ppp:read',
  PPP_WRITE: 'ppp:write',
  QUEUE_READ: 'queue:read',
  QUEUE_WRITE: 'queue:write',
  LOG_READ: 'log:read',
  SYSTEM_REBOOT: 'system:reboot',
  /** Network clients (end users): list, live usage, usage history. */
  CLIENT_READ: 'client:read',
  /** Limit bandwidth / block / unblock network clients. */
  CLIENT_WRITE: 'client:write',
  BACKUP_READ: 'backup:read',
  BACKUP_CREATE: 'backup:create',
  MONITORING_READ: 'monitoring:read',
  ALERT_READ: 'alert:read',
  ALERT_ACK: 'alert:ack',
  AUDIT_READ: 'audit:read',
  USER_READ: 'user:read',
  USER_WRITE: 'user:write',
  SETTINGS_WRITE: 'settings:write',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

const P = PERMISSIONS;

const READ_ONLY: Permission[] = [
  P.ROUTER_READ,
  P.INTERFACE_READ,
  P.IP_READ,
  P.FIREWALL_READ,
  P.DHCP_READ,
  P.PPP_READ,
  P.QUEUE_READ,
  P.LOG_READ,
  P.MONITORING_READ,
  P.ALERT_READ,
  P.CLIENT_READ,
];

/** Default role matrix (seeded; system roles). Mirrors the table in docs/security.md. */
export const DEFAULT_ROLES: Record<string, { description: string; permissions: Permission[] }> = {
  super_admin: {
    description: 'Full access including users and system settings',
    permissions: ALL_PERMISSIONS,
  },
  network_admin: {
    description: 'Full network control; can view but not manage users; no system settings',
    permissions: ALL_PERMISSIONS.filter((p) => p !== P.SETTINGS_WRITE && p !== P.USER_WRITE),
  },
  operator: {
    description: 'Day-to-day operations; firewall limited to address lists; cannot delete routers',
    permissions: [
      ...READ_ONLY,
      P.INTERFACE_WRITE,
      P.IP_WRITE,
      P.FIREWALL_ADDRESS_LIST,
      P.DHCP_WRITE,
      P.PPP_WRITE,
      P.QUEUE_WRITE,
      P.CLIENT_WRITE,
      P.BACKUP_READ,
      P.BACKUP_CREATE,
      P.ALERT_ACK,
    ],
  },
  monitoring: {
    description: 'NOC / monitoring staff: dashboards, alerts and logs',
    permissions: [
      P.ROUTER_READ,
      P.INTERFACE_READ,
      P.LOG_READ,
      P.MONITORING_READ,
      P.ALERT_READ,
      P.ALERT_ACK,
      P.CLIENT_READ,
    ],
  },
  read_only: {
    description: 'View-only access to routers and their configuration',
    permissions: READ_ONLY,
  },
};
