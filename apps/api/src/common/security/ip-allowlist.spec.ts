import { buildAllowlist } from './ip-allowlist';

describe('buildAllowlist', () => {
  it('allows everything when empty', () => {
    expect(buildAllowlist([])('203.0.113.9')).toBe(true);
  });

  it('matches IPv4 CIDRs, single IPs and v4-mapped v6', () => {
    const allow = buildAllowlist(['10.0.0.0/8', '192.168.1.10']);
    expect(allow('10.20.30.40')).toBe(true);
    expect(allow('::ffff:10.1.1.1')).toBe(true);
    expect(allow('192.168.1.10')).toBe(true);
    expect(allow('192.168.1.11')).toBe(false);
    expect(allow(undefined)).toBe(false);
    expect(allow('not-an-ip')).toBe(false);
  });

  it('matches IPv6 ranges', () => {
    const allow = buildAllowlist(['2001:db8::/32']);
    expect(allow('2001:db8::1')).toBe(true);
    expect(allow('2001:db9::1')).toBe(false);
    expect(allow('10.0.0.1')).toBe(false);
  });

  it('rejects invalid entries at startup', () => {
    expect(() => buildAllowlist(['10.0.0.0/99'])).toThrow();
  });
});
