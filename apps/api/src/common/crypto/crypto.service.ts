import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { APP_CONFIG, AppConfig } from '../../config/env';

/**
 * Envelope for secrets at rest (router passwords, TOTP seeds).
 *
 * Format: v<keyVersion>:<iv b64>:<authTag b64>:<ciphertext b64>
 *
 * AES-256-GCM gives confidentiality + integrity; the key version lets keys be rotated
 * (add CREDENTIALS_KEY_V2, switch the active version, re-encrypt, then drop V1).
 * The key never touches the database — it comes from the environment / secret manager.
 */
@Injectable()
export class CryptoService {
  constructor(@Inject(APP_CONFIG) private readonly config: Pick<AppConfig, 'credentialKeys' | 'activeKeyVersion'>) {}

  get activeKeyVersion(): number {
    return this.config.activeKeyVersion;
  }

  encrypt(plaintext: string, aad?: string): string {
    const version = this.config.activeKeyVersion;
    const key = this.key(version);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v${version}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
  }

  /**
   * @param aad optional associated data (e.g. the router id) binding the ciphertext to its row,
   *            so an encrypted password copied onto another router fails to decrypt.
   */
  decrypt(envelope: string, aad?: string): string {
    const parts = envelope.split(':');
    if (parts.length !== 4 || !parts[0].startsWith('v')) throw new Error('Malformed encrypted value');
    const version = Number(parts[0].slice(1));
    const [iv, tag, ct] = parts.slice(1).map((p) => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key(version), iv);
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  versionOf(envelope: string): number {
    return Number(envelope.split(':', 1)[0].slice(1));
  }

  private key(version: number): Buffer {
    const key = this.config.credentialKeys.get(version);
    if (!key) throw new Error(`No encryption key for version ${version}`);
    return key;
  }
}
