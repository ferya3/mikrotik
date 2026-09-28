import ipaddr from 'ipaddr.js';

export type CidrMatcher = (ip: string | undefined) => boolean;

/**
 * Builds a matcher for an allowlist of IPs / CIDRs (IPv4 and IPv6).
 * An empty list allows everything. IPv4-mapped IPv6 addresses (::ffff:10.0.0.1) are normalised.
 */
export function buildAllowlist(entries: string[]): CidrMatcher {
  if (entries.length === 0) return () => true;
  const ranges = entries.map((e) => {
    try {
      return e.includes('/') ? ipaddr.parseCIDR(e) : ([ipaddr.parse(e), e.includes(':') ? 128 : 32] as const);
    } catch {
      throw new Error(`Invalid ADMIN_IP_ALLOWLIST entry: ${e}`);
    }
  });

  return (ip) => {
    if (!ip) return false;
    let addr: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      addr = ipaddr.process(ip);
    } catch {
      return false;
    }
    return ranges.some(([net, bits]) => addr.kind() === net.kind() && addr.match(net as never, bits));
  };
}
