import { randomBytes } from 'crypto';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);

  it('round-trips and binds ciphertext to its AAD', () => {
    const svc = new CryptoService({ credentialKeys: new Map([[1, k1]]), activeKeyVersion: 1 });
    const enc = svc.encrypt('s3cret!', 'router-a');
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain('s3cret');
    expect(svc.decrypt(enc, 'router-a')).toBe('s3cret!');
    expect(() => svc.decrypt(enc, 'router-b')).toThrow();
  });

  it('decrypts old key versions after rotation', () => {
    const old = new CryptoService({ credentialKeys: new Map([[1, k1]]), activeKeyVersion: 1 });
    const enc = old.encrypt('pw');
    const rotated = new CryptoService({
      credentialKeys: new Map([
        [1, k1],
        [2, k2],
      ]),
      activeKeyVersion: 2,
    });
    expect(rotated.decrypt(enc)).toBe('pw');
    expect(rotated.versionOf(rotated.encrypt('pw'))).toBe(2);
  });

  it('detects tampering', () => {
    const svc = new CryptoService({ credentialKeys: new Map([[1, k1]]), activeKeyVersion: 1 });
    const [v, iv, tag, ct] = svc.encrypt('pw').split(':');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 1;
    expect(() => svc.decrypt([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow();
  });
});
