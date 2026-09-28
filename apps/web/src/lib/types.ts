export type RouterStatus = 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'AUTH_FAILED';

export interface Me {
  id: string;
  username: string;
  fullName: string | null;
  email: string | null;
  totpEnabled: boolean;
  role: string;
  permissions: string[];
}

export interface RouterRow {
  id: string;
  name: string;
  host: string;
  port: number | null;
  connectionType: 'REST' | 'API';
  useTls: boolean;
  verifyTls: boolean;
  sshPort: number;
  sshHostKeySha256: string | null;
  location: string | null;
  tags: string[];
  status: RouterStatus;
  lastSeenAt: string | null;
  identity: string | null;
  boardName: string | null;
  version: string | null;
  architecture: string | null;
  serialNumber: string | null;
  group: { id: string; name: string } | null;
  username: string | null;
}

export interface InterfaceLive {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  rxBps: number;
  txBps: number;
}

export interface RouterLive {
  routerId: string;
  status: RouterStatus;
  ts: number;
  error?: string;
  cpuLoad?: number;
  memUsed?: number;
  memTotal?: number;
  uptime?: string;
  temperature?: number | null;
  rxBps?: number;
  txBps?: number;
  pppActive?: number;
  interfaces?: InterfaceLive[];
}

export interface Overview {
  totals: { routers: number; online: number; offline: number; avgCpu: number | null; openAlerts: number };
  routers: (Pick<RouterRow, 'id' | 'name' | 'host' | 'status' | 'lastSeenAt' | 'version'> & {
    group: { id: string; name: string } | null;
    live: RouterLive | null;
  })[];
}

export interface Alert {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  state: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  message: string;
  createdAt: string;
  resolvedAt: string | null;
  router: { id: string; name: string; host: string } | null;
}

export interface AuditLog {
  id: string;
  username: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  result: 'SUCCESS' | 'FAILURE' | 'DENIED';
  error: string | null;
  ip: string | null;
  createdAt: string;
  router: { id: string; name: string } | null;
}

export interface Backup {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  sha256: string | null;
  sizeBytes: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  createdBy: { username: string } | null;
}

export interface RouterGroup {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  _count: { routers: number };
}

/** RouterOS rows are passed through as-is: kebab-case keys, ".id", string values. */
export type RosRow = Record<string, string>;
