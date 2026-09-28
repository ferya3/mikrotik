import { configDiff, normalizeExport } from './config-diff';

describe('config diff', () => {
  const a = `# 2026-09-27 03:00:01 by RouterOS 7.16
# software id = ABCD-1234
/ip firewall filter add action=drop chain=input src-address=10.0.0.5
/ip dns set servers=1.1.1.1`;
  const b = `# 2026-09-28 03:00:02 by RouterOS 7.16
# software id = ABCD-1234
/ip firewall filter add action=accept chain=input src-address=10.0.0.5
/ip dns set servers=1.1.1.1`;

  it('ignores the export timestamp header', () => {
    expect(normalizeExport(a)).not.toContain('2026-09-27');
    expect(configDiff('a', a, 'b', a.replace('2026-09-27', '2026-09-29'))).not.toMatch(/^[+-][^+-]/m);
  });

  it('shows changed lines as -/+', () => {
    const d = configDiff('Sep 27', a, 'Sep 28', b);
    expect(d).toContain('-/ip firewall filter add action=drop chain=input src-address=10.0.0.5');
    expect(d).toContain('+/ip firewall filter add action=accept chain=input src-address=10.0.0.5');
    expect(d).not.toContain('-/ip dns');
  });
});
