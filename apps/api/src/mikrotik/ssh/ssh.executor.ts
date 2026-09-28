import { createHash } from 'crypto';
import { Client } from 'ssh2';
import { RouterAuthError, RouterConnectionError } from '../errors';

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Pinned host key fingerprint (base64 SHA-256). Undefined → trust on first use. */
  hostKeySha256?: string | null;
  timeoutMs: number;
}

/** Only these fixed commands can be executed over SSH — never user-provided text. */
export const SSH_COMMANDS = {
  EXPORT: '/export terse',
} as const;

export type SshCommand = (typeof SSH_COMMANDS)[keyof typeof SSH_COMMANDS];

export interface SshResult {
  output: string;
  hostKeySha256: string;
}

/**
 * SSH fallback, used for things the API/REST cannot do well — chiefly a full text `/export`
 * for diffable backups. Host keys are pinned (TOFU) to prevent MITM.
 */
export function runSshCommand(target: SshTarget, command: SshCommand): Promise<SshResult> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let seenKey = '';
    let settled = false;
    const done = (err: Error | null, res?: SshResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      conn.end();
      if (err) reject(err);
      else resolve(res!);
    };
    const overall = setTimeout(() => done(new RouterConnectionError('SSH command timed out')), target.timeoutMs * 8);

    conn
      .on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) return done(new RouterConnectionError(err.message));
          const out: Buffer[] = [];
          stream.on('data', (d: Buffer) => out.push(d));
          stream.stderr.on('data', (d: Buffer) => out.push(d));
          stream.on('close', () => {
            done(null, { output: Buffer.concat(out).toString('utf8').replace(/\r/g, ''), hostKeySha256: seenKey });
          });
        });
      })
      .on('error', (err: Error & { level?: string }) => {
        if (err.level === 'client-authentication') done(new RouterAuthError('SSH authentication failed'));
        else done(new RouterConnectionError(`SSH ${target.host}:${target.port} ${err.message}`));
      })
      .connect({
        host: target.host,
        port: target.port,
        username: target.username,
        password: target.password,
        readyTimeout: target.timeoutMs,
        tryKeyboard: false,
        hostVerifier: (key: Buffer) => {
          seenKey = createHash('sha256').update(key).digest('base64');
          if (target.hostKeySha256 && target.hostKeySha256 !== seenKey) {
            // Reject: the router's identity changed (reinstall) or someone is in the middle.
            done(new RouterConnectionError(`SSH host key mismatch (expected ${target.hostKeySha256}, got ${seenKey})`));
            return false;
          }
          return true;
        },
      });
  });
}
