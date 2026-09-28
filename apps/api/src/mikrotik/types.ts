/**
 * Menu paths the platform is allowed to touch. The adapter layer rejects anything else,
 * so no code path can turn user input into an arbitrary RouterOS command.
 */
export const MENU_PATHS = [
  '/system/resource',
  '/system/identity',
  '/system/routerboard',
  '/system/health',
  '/system',
  '/interface',
  '/ip/address',
  '/ip/route',
  '/ip/dns',
  '/ip/firewall/filter',
  '/ip/firewall/nat',
  '/ip/firewall/address-list',
  '/ip/firewall/connection',
  '/ip/arp',
  '/ip/hotspot/active',
  '/ip/dhcp-server',
  '/ip/dhcp-server/lease',
  '/ip/dhcp-server/network',
  '/ppp/secret',
  '/ppp/active',
  '/ppp/profile',
  '/queue/simple',
  '/log',
] as const;

export type MenuPath = (typeof MENU_PATHS)[number];

/** RouterOS returns every property as a string (kebab-case keys, ".id" for the internal id). */
export type RosRecord = Record<string, string>;
export type RosProps = Record<string, string>;

export interface PrintOptions {
  /** Only return these properties (.proplist). */
  proplist?: string[];
  /** Equality filters (API "?key=value", REST "?key=value"). */
  where?: Record<string, string>;
}

/**
 * Transport-agnostic primitive operations. Everything above this layer (typed facade,
 * services, controllers) is independent of whether we talk REST, API or something else.
 */
export interface RouterAdapter {
  readonly transport: 'REST' | 'API';
  print(path: MenuPath, opts?: PrintOptions): Promise<RosRecord[]>;
  get(path: MenuPath, id: string): Promise<RosRecord>;
  add(path: MenuPath, props: RosProps): Promise<string>;
  set(path: MenuPath, id: string, props: RosProps): Promise<void>;
  remove(path: MenuPath, id: string): Promise<void>;
  /** Runs a menu command such as /ip/firewall/filter/move or /system/reboot. */
  command(path: MenuPath, command: RosCommand, params?: RosProps): Promise<RosRecord[]>;
  close(): Promise<void>;
}

export const ROS_COMMANDS = ['move', 'reboot', 'make-static', 'unset'] as const;
export type RosCommand = (typeof ROS_COMMANDS)[number];

export interface RouterConnectionInfo {
  id: string;
  host: string;
  port?: number | null;
  connectionType: 'REST' | 'API';
  useTls: boolean;
  verifyTls: boolean;
  sshPort: number;
  sshHostKeySha256?: string | null;
  username: string;
  password: string;
  timeoutMs: number;
}

const PATH_RE = /^(\/[a-z0-9-]+)+$/;
const KEY_RE = /^\.?[a-z0-9][a-z0-9-]*$/;
export const ROS_ID_RE = /^\*[0-9A-Fa-f]{1,16}$/;

export function assertPath(path: string): asserts path is MenuPath {
  if (!PATH_RE.test(path) || !(MENU_PATHS as readonly string[]).includes(path)) {
    throw new Error(`Menu path not allowed: ${path}`);
  }
}

export function assertCommand(cmd: string): asserts cmd is RosCommand {
  if (!(ROS_COMMANDS as readonly string[]).includes(cmd)) throw new Error(`Command not allowed: ${cmd}`);
}

export function assertId(id: string): void {
  if (!ROS_ID_RE.test(id)) throw new Error(`Invalid RouterOS id: ${id}`);
}

export function assertProps(props: RosProps): void {
  for (const [k, v] of Object.entries(props)) {
    if (!KEY_RE.test(k)) throw new Error(`Invalid RouterOS property name: ${k}`);
    if (typeof v !== 'string') throw new Error(`RouterOS property ${k} must be a string`);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) {
      throw new Error(`RouterOS property ${k} contains control characters`);
    }
  }
}
