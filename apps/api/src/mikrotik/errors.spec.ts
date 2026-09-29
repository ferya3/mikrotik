import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { RestRouterAdapter } from './rest/rest.adapter';

describe('connection error messages', () => {
  let server: Server;
  let port: number;
  beforeAll(async () => {
    server = createServer((_req, res) => res.end('{}'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const adapter = (tls: boolean, p = port) =>
    new RestRouterAdapter({ host: '127.0.0.1', port: p, tls, verifyTls: false, username: 'u', password: 'p', timeoutMs: 2000 });

  it('explains a TLS client talking to a plain-HTTP port (the "Use TLS" on port 80 mistake)', async () => {
    const a = adapter(true);
    await expect(a.print('/system/identity')).rejects.toThrow(/is not a TLS port. Turn off "Use TLS"/);
    await a.close();
  });

  it('explains a refused connection', async () => {
    const a = adapter(false, 1);
    await expect(a.print('/system/identity')).rejects.toThrow(/refused the connection/);
    await a.close();
  });
});
