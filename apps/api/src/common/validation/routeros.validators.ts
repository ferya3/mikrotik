import { registerDecorator, ValidationOptions } from 'class-validator';
import ipaddr from 'ipaddr.js';

/**
 * Validators for RouterOS values. Input is validated here *and* passed to the router as discrete
 * parameters (never as CLI text), so malformed input fails early with a clear message.
 */

function isIp(s: string): boolean {
  return ipaddr.isValid(s) && (ipaddr.IPv4.isValidFourPartDecimal(s) || s.includes(':'));
}

export function isCidr(s: string): boolean {
  try {
    ipaddr.parseCIDR(s);
    return isIp(s.split('/')[0]);
  } catch {
    return false;
  }
}

export function isIpOrCidr(s: string): boolean {
  return isIp(s) || isCidr(s);
}

/** Firewall address matcher: IP, CIDR or range "a-b", optionally negated with "!". */
export function isAddressMatcher(s: string): boolean {
  const v = s.startsWith('!') ? s.slice(1) : s;
  if (isIpOrCidr(v)) return true;
  const parts = v.split('-');
  return parts.length === 2 && isIp(parts[0]) && isIp(parts[1]);
}

export function isPortSpec(s: string): boolean {
  const v = s.startsWith('!') ? s.slice(1) : s;
  if (!/^\d{1,5}(-\d{1,5})?(,\d{1,5}(-\d{1,5})?)*$/.test(v)) return false;
  return v
    .split(/[,-]/)
    .map(Number)
    .every((n) => n >= 0 && n <= 65535);
}

const HOSTNAME_RE = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

export function isHost(s: string): boolean {
  return isIp(s) || HOSTNAME_RE.test(s);
}

function make(name: string, test: (v: string) => boolean, message: string) {
  return (opts?: ValidationOptions) => (object: object, propertyName: string) =>
    registerDecorator({
      name,
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} ${message}`, ...opts },
      validator: { validate: (v: unknown) => typeof v === 'string' && test(v) },
    });
}

export const IsCidr = make('isCidr', isCidr, 'must be an address with prefix, e.g. 192.168.88.1/24');
export const IsIpOrCidr = make('isIpOrCidr', isIpOrCidr, 'must be an IP address or CIDR');
export const IsAddressMatcher = make(
  'isAddressMatcher',
  isAddressMatcher,
  'must be an IP, CIDR or range (a-b), optionally prefixed with !',
);
export const IsPortSpec = make('isPortSpec', isPortSpec, 'must be a port list such as 22 or 80,443 or 1000-2000');
export const IsHost = make('isHost', isHost, 'must be an IP address or hostname');
/** Interface / list / profile / queue names. */
export const IsRosName = make(
  'isRosName',
  (v) => /^[\p{L}\p{N} _.:@+/-]{1,64}$/u.test(v),
  'may contain letters, digits, space and _ . : @ + / - (max 64)',
);
export const IsRosComment = make(
  'isRosComment',
  (v) => v.length <= 255 && !/[\u0000-\u001f\u007f]/.test(v),
  'must be at most 255 printable characters',
);
export const IsRosId = make('isRosId', (v) => /^\*[0-9A-Fa-f]{1,16}$/.test(v), 'must be a RouterOS id like *1A');
/** e.g. 10M/20M, 512k/1M. */
export const IsRateLimit = make('isRateLimit', (v) => /^\d+[kKMG]?\/\d+[kKMG]?$/.test(v), 'must look like 10M/10M');
/** RouterOS durations: 1d, 00:10:00, 1h30m. */
export const IsRosDuration = make('isRosDuration', (v) => /^[0-9wdhms:]{1,32}$/.test(v), 'must be a duration like 1d or 00:10:00');
export const IsMac = make('isMac', (v) => /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(v), 'must be a MAC address');
/** Comma separated list of IP/CIDR targets (simple queues). */
export const IsTargetList = make(
  'isTargetList',
  (v) => v.split(',').every((t) => isIpOrCidr(t.trim()) || /^[\p{L}\p{N}_.-]{1,64}$/u.test(t.trim())),
  'must be a comma separated list of IP/CIDR or interface names',
);
