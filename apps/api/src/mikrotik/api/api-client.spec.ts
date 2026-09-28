import { AddressInfo, createServer, Server, Socket } from 'net';
import { RouterAuthError, RouterCommandError } from '../errors';
import { ApiRouterAdapter } from './api.adapter';
import { RouterOsApiClient } from './api-client';
import { encodeSentence, SentenceDecoder } from './protocol';

/** A tiny in-process RouterOS API impostor, enough to exercise the client end to end. */
function fakeRouter(handler: (words: string[], reply: (...sentences: string[][]) => void) => void): Promise<Server> {
  const server = createServer((sock: Socket) => {
    const dec = new SentenceDecoder();
    sock.on('data', (chunk) => {
      for (const words of dec.push(chunk)) {
        const tag = words.find((w) => w.startsWith('.tag='));
        handler(
          words.filter((w) => !w.startsWith('.tag=')),
          (...sentences) => sentences.forEach((s) => sock.write(encodeSentence(tag ? [...s, tag] : s))),
        );
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const rules = [
  { '.id': '*1', chain: 'input', action: 'accept' },
  { '.id': '*2', chain: 'input', action: 'drop' },
];

describe('RouterOsApiClient', () => {
  let server: Server;
  let client: RouterOsApiClient;
  const received: string[][] = [];

  beforeAll(async () => {
    server = await fakeRouter((words, reply) => {
      received.push(words);
      const [cmd] = words;
      if (cmd === '/login') {
        if (words.includes('=password=good')) return reply(['!done']);
        return reply(['!trap', '=message=invalid user name or password (6)'], ['!done']);
      }
      if (cmd === '/ip/firewall/filter/print') {
        const q = words.find((w) => w.startsWith('?.id='))?.slice(5);
        const rows = rules.filter((r) => !q || r['.id'] === q);
        return reply(...rows.map((r) => ['!re', ...Object.entries(r).map(([k, v]) => `=${k}=${v}`)]), ['!done']);
      }
      if (cmd === '/ip/firewall/filter/add') return reply(['!done', '=ret=*3']);
      if (cmd === '/ip/firewall/filter/remove') {
        return reply(['!trap', '=message=no such item'], ['!done']);
      }
      reply(['!done']);
    });
  });

  afterAll(async () => {
    await client?.close();
    await new Promise((r) => server.close(r));
  });

  const connect = () =>
    RouterOsApiClient.connect({
      host: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      tls: false,
      verifyTls: false,
      timeoutMs: 2000,
    });

  it('rejects bad credentials with RouterAuthError', async () => {
    const c = await connect();
    await expect(c.login('admin', 'bad')).rejects.toBeInstanceOf(RouterAuthError);
    await c.close();
  });

  it('logs in, prints, gets, adds and surfaces traps', async () => {
    client = await connect();
    await client.login('admin', 'good');
    const api = new ApiRouterAdapter(client);

    await expect(api.print('/ip/firewall/filter')).resolves.toEqual(rules);
    await expect(api.get('/ip/firewall/filter', '*2')).resolves.toEqual(rules[1]);
    await expect(api.add('/ip/firewall/filter', { chain: 'input', action: 'drop', comment: 'a=b\nc' })).resolves.toBe(
      '*3',
    );
    expect(received.at(-1)).toEqual(['/ip/firewall/filter/add', '=chain=input', '=action=drop', '=comment=a=b\nc']);
    await expect(api.remove('/ip/firewall/filter', '*9')).rejects.toBeInstanceOf(RouterCommandError);
  });

  it('multiplexes concurrent requests on one connection', async () => {
    const api = new ApiRouterAdapter(client);
    const results = await Promise.all([
      api.get('/ip/firewall/filter', '*1'),
      api.get('/ip/firewall/filter', '*2'),
      api.print('/ip/firewall/filter'),
    ]);
    expect(results[0]).toEqual(rules[0]);
    expect(results[1]).toEqual(rules[1]);
    expect(results[2]).toHaveLength(2);
  });

  it('refuses paths, commands and ids outside the allowlist', async () => {
    const api = new ApiRouterAdapter(client);
    await expect(api.print('/user' as never)).rejects.toThrow(/not allowed/);
    await expect(api.command('/system', 'shutdown' as never)).rejects.toThrow(/not allowed/);
    await expect(api.remove('/ip/firewall/filter', '1; /system reboot')).rejects.toThrow(/Invalid RouterOS id/);
    await expect(api.add('/ip/firewall/filter', { 'bad key': 'x' })).rejects.toThrow(/property name/);
  });
});
