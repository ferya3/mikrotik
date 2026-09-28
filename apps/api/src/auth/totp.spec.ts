import { base32Decode, base32Encode, generateTotpSecret, hotp, totp, verifyTotp } from './totp';

describe('TOTP', () => {
  // RFC 4226 Appendix D test vectors, secret "12345678901234567890".
  const rfcSecret = Buffer.from('12345678901234567890');

  it('matches RFC 4226 HOTP vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, counter) => expect(hotp(rfcSecret, counter)).toBe(code));
  });

  it('matches RFC 6238 SHA-1 vector (T=59s → 94287082, last 6 digits)', () => {
    expect(totp(base32Encode(rfcSecret), 59_000)).toBe('287082');
  });

  it('round-trips base32', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });

  it('verifies with ±1 step drift and rejects others', () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    expect(verifyTotp(secret, totp(secret, now), now)).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).not.toBeNull();
    expect(verifyTotp(secret, totp(secret, now - 120_000), now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });
});
