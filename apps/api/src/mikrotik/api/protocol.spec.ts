import { decodeLength, encodeLength, encodeSentence, parseSentence, SentenceDecoder } from './protocol';

describe('RouterOS API protocol', () => {
  it.each([0, 1, 0x7f, 0x80, 0x3fff, 0x4000, 0x1fffff, 0x200000, 0xfffffff, 0x10000000])(
    'round-trips length %i',
    (len) => {
      const enc = encodeLength(len);
      expect(decodeLength(enc, 0)).toEqual([len, enc.length]);
    },
  );

  it('uses the documented byte layouts', () => {
    expect([...encodeLength(0x7f)]).toEqual([0x7f]);
    expect([...encodeLength(0x80)]).toEqual([0x80, 0x80]);
    expect([...encodeLength(0x4000)]).toEqual([0xc0, 0x40, 0x00]);
  });

  it('decodes sentences split across arbitrary TCP chunks', () => {
    const wire = Buffer.concat([
      encodeSentence(['!re', '=name=ether1', '=comment=a=b', '.tag=7']),
      encodeSentence(['!done', '.tag=7']),
    ]);
    const dec = new SentenceDecoder();
    const out: string[][] = [];
    for (let i = 0; i < wire.length; i += 3) out.push(...dec.push(wire.subarray(i, i + 3)));
    expect(out).toEqual([
      ['!re', '=name=ether1', '=comment=a=b', '.tag=7'],
      ['!done', '.tag=7'],
    ]);
  });

  it('parses attributes whose values contain "="', () => {
    const r = parseSentence(['!re', '=comment=x=y=z', '=.id=*1A', '.tag=3']);
    expect(r).toEqual({ type: '!re', tag: '3', attrs: { comment: 'x=y=z', '.id': '*1A' } });
  });

  it('keeps a value containing newlines inside one word (no injection)', () => {
    const evil = 'x\n/system/reboot';
    const dec = new SentenceDecoder();
    const [sentence] = dec.push(encodeSentence(['/ip/firewall/filter/add', `=comment=${evil}`]));
    expect(sentence).toEqual(['/ip/firewall/filter/add', `=comment=${evil}`]);
  });
});
