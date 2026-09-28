import { createHash } from 'crypto';
import { connect as netConnect, Socket } from 'net';
import { connect as tlsConnect } from 'tls';
import { RouterAuthError, RouterCommandError, RouterConnectionError } from '../errors';
import { encodeSentence, parseSentence, Reply, SentenceDecoder } from './protocol';

export interface ApiClientOptions {
  host: string;
  port: number;
  tls: boolean;
  verifyTls: boolean;
  timeoutMs: number;
}

interface Pending {
  replies: Reply[];
  trap?: Reply;
  resolve: (r: Reply[]) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Minimal, dependency-free RouterOS API client with tagged (multiplexed) requests,
 * so several commands can be in flight on one connection.
 */
export class RouterOsApiClient {
  private readonly decoder = new SentenceDecoder();
  private readonly pending = new Map<string, Pending>();
  private seq = 0;
  private closed = false;

  private constructor(
    private readonly socket: Socket,
    private readonly timeoutMs: number,
  ) {
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const words of this.decoder.push(chunk)) this.onReply(parseSentence(words));
      } catch (e) {
        this.fail(new RouterConnectionError(`Protocol error: ${(e as Error).message}`));
      }
    });
    socket.on('error', (e) => this.fail(new RouterConnectionError(e.message)));
    socket.on('close', () => this.fail(new RouterConnectionError('Connection closed')));
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  static async connect(opts: ApiClientOptions): Promise<RouterOsApiClient> {
    const socket = await new Promise<Socket>((resolve, reject) => {
      const onError = (e: Error) => reject(new RouterConnectionError(`${opts.host}:${opts.port} ${e.message}`));
      const s: Socket = opts.tls
        ? tlsConnect({
            host: opts.host,
            port: opts.port,
            rejectUnauthorized: opts.verifyTls,
            // RouterOS API-SSL without a certificate only offers anonymous DH suites.
            ciphers: opts.verifyTls ? undefined : 'DEFAULT:ADH-AES256-GCM-SHA384:ADH-AES128-SHA256:@SECLEVEL=0',
            servername: /^[\d.]+$|:/.test(opts.host) ? undefined : opts.host,
          })
        : netConnect({ host: opts.host, port: opts.port });
      s.setTimeout(opts.timeoutMs, () => s.destroy(new Error('connect timeout')));
      s.once('error', onError);
      s.once(opts.tls ? 'secureConnect' : 'connect', () => {
        s.off('error', onError);
        s.setTimeout(0);
        s.setKeepAlive(true, 30_000);
        resolve(s);
      });
    });
    return new RouterOsApiClient(socket, opts.timeoutMs);
  }

  /** Supports both post-6.43 plaintext login and the legacy MD5 challenge. */
  async login(username: string, password: string): Promise<void> {
    try {
      const first = await this.send(['/login', `=name=${username}`, `=password=${password}`]);
      const challenge = first.find((r) => r.type === '!done')?.attrs.ret;
      if (challenge) {
        const md5 = createHash('md5')
          .update(Buffer.concat([Buffer.from([0]), Buffer.from(password, 'utf8'), Buffer.from(challenge, 'hex')]))
          .digest('hex');
        await this.send(['/login', `=name=${username}`, `=response=00${md5}`]);
      }
    } catch (e) {
      if (e instanceof RouterCommandError) throw new RouterAuthError(e.message);
      throw e;
    }
  }

  /** Sends one command sentence and resolves with its !re replies. */
  send(words: string[]): Promise<Reply[]> {
    if (this.closed) return Promise.reject(new RouterConnectionError('Connection closed'));
    const tag = String(++this.seq);
    return new Promise<Reply[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(tag);
        reject(new RouterConnectionError(`Timeout waiting for ${words[0]}`));
      }, this.timeoutMs);
      this.pending.set(tag, { replies: [], resolve, reject, timer });
      this.socket.write(encodeSentence([...words, `.tag=${tag}`]));
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.socket.end();
    this.socket.destroy();
    this.rejectAll(new RouterConnectionError('Connection closed'));
  }

  private onReply(reply: Reply): void {
    if (reply.type === '!fatal') {
      this.fail(new RouterConnectionError(`Router closed the session: ${reply.message ?? 'fatal'}`));
      return;
    }
    const p = reply.tag ? this.pending.get(reply.tag) : undefined;
    if (!p) return; // late reply after a timeout
    switch (reply.type) {
      case '!re':
        p.replies.push(reply);
        break;
      case '!trap':
        p.trap = reply;
        break;
      case '!done':
        clearTimeout(p.timer);
        this.pending.delete(reply.tag!);
        if (p.trap) p.reject(new RouterCommandError(p.trap.attrs.message ?? 'Command failed'));
        else p.resolve([...p.replies, reply]);
        break;
      default: // !empty (RouterOS 7.18+): no rows, a !done follows
        break;
    }
  }

  private fail(err: Error): void {
    if (!this.closed) {
      this.closed = true;
      this.socket.destroy();
    }
    this.rejectAll(err);
  }

  private rejectAll(err: Error): void {
    for (const [tag, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(tag);
    }
  }
}
