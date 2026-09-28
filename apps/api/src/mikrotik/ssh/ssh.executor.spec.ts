import { generateKeyPairSync } from 'crypto';
import { AddressInfo } from 'net';
import { Server } from 'ssh2';
import { RouterAuthError, RouterConnectionError } from '../errors';
import { runSshCommand, SSH_COMMANDS } from './ssh.executor';

const EXPORT = '# 2026-09-28 03:00:00 by RouterOS 7.16\n/ip dns set servers=1.1.1.1\r\n';

describe('runSshCommand', () => {
  let server: Server;
  let port: number;
  const executed: string[] = [];

  beforeAll(async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    server = new Server({ hostKeys: [privateKey] }, (client) => {
      client
        .on('authentication', (ctx) => {
          if (ctx.method === 'password' && ctx.username === 'backup' && ctx.password === 'pw') ctx.accept();
          else ctx.reject(['password']);
        })
        .on('ready', () => {
          client.on('session', (accept) => {
            accept().once('exec', (acceptExec, _reject, info) => {
              executed.push(info.command);
              const stream = acceptExec();
              stream.write(EXPORT);
              stream.exit(0);
              stream.end();
            });
          });
        })
        .on('error', () => undefined);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const target = (over: Partial<Parameters<typeof runSshCommand>[0]> = {}) => ({
    host: '127.0.0.1',
    port,
    username: 'backup',
    password: 'pw',
    timeoutMs: 5000,
    ...over,
  });

  it('runs only the fixed export command and strips CRs', async () => {
    const res = await runSshCommand(target(), SSH_COMMANDS.EXPORT);
    expect(executed.at(-1)).toBe('/export terse');
    expect(res.output).toBe(EXPORT.replace(/\r/g, ''));
    expect(res.hostKeySha256).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('accepts the pinned host key and rejects a different one', async () => {
    const first = await runSshCommand(target(), SSH_COMMANDS.EXPORT);
    await expect(runSshCommand(target({ hostKeySha256: first.hostKeySha256 }), SSH_COMMANDS.EXPORT)).resolves.toBeTruthy();
    await expect(runSshCommand(target({ hostKeySha256: 'AAAA' }), SSH_COMMANDS.EXPORT)).rejects.toThrow(
      /host key mismatch/,
    );
  });

  it('maps bad credentials to RouterAuthError and closed ports to RouterConnectionError', async () => {
    await expect(runSshCommand(target({ password: 'nope' }), SSH_COMMANDS.EXPORT)).rejects.toBeInstanceOf(RouterAuthError);
    await expect(runSshCommand(target({ port: 1 }), SSH_COMMANDS.EXPORT)).rejects.toBeInstanceOf(RouterConnectionError);
  });
});
