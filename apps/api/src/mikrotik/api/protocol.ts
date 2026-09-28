/**
 * RouterOS API wire format (ports 8728 / 8729-TLS).
 * https://help.mikrotik.com/docs/display/ROS/API
 *
 * A sentence is a sequence of length-prefixed words terminated by a zero-length word.
 * Because every word is length-prefixed, a value can never "break out" into another
 * word or command — this is what makes parameter passing injection-safe.
 */

export function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) return Buffer.from([((len >> 8) & 0xff) | 0x80, len & 0xff]);
  if (len < 0x200000) return Buffer.from([((len >> 16) & 0xff) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
  if (len < 0x10000000) {
    return Buffer.from([((len >>> 24) & 0xff) | 0xe0, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  }
  return Buffer.from([0xf0, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

/** Returns [length, headerBytes] or null if the buffer does not yet hold the full header. */
export function decodeLength(buf: Buffer, offset: number): [number, number] | null {
  if (offset >= buf.length) return null;
  const b0 = buf[offset];
  const need = (n: number) => offset + n <= buf.length;
  if ((b0 & 0x80) === 0x00) return [b0, 1];
  if ((b0 & 0xc0) === 0x80) return need(2) ? [((b0 & 0x3f) << 8) | buf[offset + 1], 2] : null;
  if ((b0 & 0xe0) === 0xc0) {
    return need(3) ? [((b0 & 0x1f) << 16) | (buf[offset + 1] << 8) | buf[offset + 2], 3] : null;
  }
  if ((b0 & 0xf0) === 0xe0) {
    return need(4)
      ? [((b0 & 0x0f) * 0x1000000 + ((buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3])) >>> 0, 4]
      : null;
  }
  if (b0 === 0xf0) return need(5) ? [buf.readUInt32BE(offset + 1), 5] : null;
  throw new Error(`Invalid API length prefix 0x${b0.toString(16)}`);
}

export function encodeSentence(words: string[]): Buffer {
  const parts: Buffer[] = [];
  for (const w of words) {
    const bytes = Buffer.from(w, 'utf8');
    parts.push(encodeLength(bytes.length), bytes);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

export type ReplyType = '!re' | '!done' | '!trap' | '!fatal' | '!empty';

export interface Reply {
  type: ReplyType;
  tag?: string;
  attrs: Record<string, string>;
  /** For !fatal the reason is a bare word, not an attribute. */
  message?: string;
}

export function parseSentence(words: string[]): Reply {
  const [type, ...rest] = words;
  const reply: Reply = { type: type as ReplyType, attrs: {} };
  for (const w of rest) {
    if (w.startsWith('.tag=')) {
      reply.tag = w.slice(5);
    } else if (w.startsWith('=')) {
      const eq = w.indexOf('=', 1);
      if (eq === -1) reply.attrs[w.slice(1)] = '';
      else reply.attrs[w.slice(1, eq)] = w.slice(eq + 1);
    } else if (type === '!fatal') {
      reply.message = w;
    }
  }
  return reply;
}

/** Incremental stream decoder: feed TCP chunks, get complete sentences back. */
export class SentenceDecoder {
  private buf: Buffer = Buffer.alloc(0);
  private words: string[] = [];

  push(chunk: Buffer): string[][] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const sentences: string[][] = [];
    let offset = 0;
    for (;;) {
      const header = decodeLength(this.buf, offset);
      if (!header) break;
      const [len, hlen] = header;
      if (offset + hlen + len > this.buf.length) break;
      offset += hlen;
      if (len === 0) {
        if (this.words.length) sentences.push(this.words);
        this.words = [];
      } else {
        this.words.push(this.buf.toString('utf8', offset, offset + len));
        offset += len;
      }
    }
    this.buf = this.buf.subarray(offset);
    return sentences;
  }
}
