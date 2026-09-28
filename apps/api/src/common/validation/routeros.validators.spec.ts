import { isAddressMatcher, isCidr, isHost, isPortSpec } from './routeros.validators';

describe('RouterOS validators', () => {
  it('validates CIDRs', () => {
    expect(isCidr('192.168.88.1/24')).toBe(true);
    expect(isCidr('2001:db8::1/64')).toBe(true);
    expect(isCidr('192.168.88.1')).toBe(false);
    expect(isCidr('192.168.88.1/33')).toBe(false);
    expect(isCidr('10.0.0.1/24; /system reboot')).toBe(false);
  });

  it('validates firewall address matchers', () => {
    expect(isAddressMatcher('10.0.0.0/8')).toBe(true);
    expect(isAddressMatcher('!10.0.0.0/8')).toBe(true);
    expect(isAddressMatcher('10.0.0.1-10.0.0.50')).toBe(true);
    expect(isAddressMatcher('10.0.0.1-')).toBe(false);
    expect(isAddressMatcher('1')).toBe(false); // ipaddr accepts "1" as 0.0.0.1; we don't
  });

  it('validates port specs', () => {
    expect(isPortSpec('22')).toBe(true);
    expect(isPortSpec('80,443,8000-8100')).toBe(true);
    expect(isPortSpec('!53')).toBe(true);
    expect(isPortSpec('70000')).toBe(false);
    expect(isPortSpec('22 ')).toBe(false);
  });

  it('validates hosts', () => {
    expect(isHost('10.0.0.1')).toBe(true);
    expect(isHost('core-01.example.net')).toBe(true);
    expect(isHost('bad host')).toBe(false);
  });
});
