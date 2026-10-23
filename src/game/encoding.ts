import type { Encoding } from './types';

const utf8 = new TextEncoder();
const utf8d = new TextDecoder('utf-8', { fatal: true });

function toBase64(s: string): string {
  let bin = '';
  for (const b of utf8.encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(s: string): string | null {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return utf8d.decode(bytes);
  } catch {
    return null;
  }
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** Characters worth hiding: anything that makes a payload recognisable. */
const SPECIAL = /[^A-Za-z0-9_.~-]/g;

export function encode(s: string, enc: Encoding): string {
  switch (enc) {
    case 'url':
      return s.replace(SPECIAL, (c) =>
        Array.from(utf8.encode(c), (b) => '%' + hex2(b).toUpperCase()).join(''),
      );
    case 'base64':
      return toBase64(s);
    case 'html':
      return s.replace(/[<>"'()/=:;&{}$ ]/g, (c) => `&#x${hex2(c.charCodeAt(0))};`);
    case 'hex':
      return Array.from(s, (c) => {
        const code = c.charCodeAt(0);
        return code < 256 ? '\\x' + hex2(code) : '\\u' + code.toString(16).padStart(4, '0');
      }).join('');
  }
}

export function encodeLayers(plain: string, layers: Encoding[]): string {
  return layers.reduce((s, enc) => encode(s, enc), plain);
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', quot: '"', amp: '&', apos: "'" };

/** Mostly printable text, so base64 guesses on plain words don't produce junk. */
function looksPrintable(s: string): boolean {
  if (!s.length) return false;
  let ok = 0;
  for (const c of s) {
    const code = c.charCodeAt(0);
    if ((code >= 32 && code < 127) || c === '\n' || c === '\r' || c === '\t' || code > 159) ok++;
  }
  return ok / s.length > 0.95;
}

/** Undo one layer. Returns null when the decoder doesn't apply. */
export function decode(s: string, enc: Encoding): string | null {
  switch (enc) {
    case 'url': {
      if (!/%[0-9a-f]{2}/i.test(s)) return null;
      try {
        return decodeURIComponent(s);
      } catch {
        return s.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
      }
    }
    case 'base64': {
      const t = s.trim();
      if (t.length < 8 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(t)) return null;
      const out = fromBase64(t);
      return out && looksPrintable(out) && out !== t ? out : null;
    }
    case 'html': {
      if (!/&(#x[0-9a-f]+|#\d+|lt|gt|quot|amp|apos);/i.test(s)) return null;
      return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|amp|apos);/gi, (_, e: string) => {
        if (e[0] === '#') {
          const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return String.fromCodePoint(code);
        }
        return NAMED[e.toLowerCase()];
      });
    }
    case 'hex': {
      if (!/\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i.test(s)) return null;
      return s.replace(/\\x([0-9a-f]{2})|\\u([0-9a-f]{4})/gi, (_, a, b) =>
        String.fromCharCode(parseInt(a ?? b, 16)),
      );
    }
  }
}

export interface JwtParts {
  header: string;
  payload: string;
  signature: string;
}

export function decodeJwt(token: string): JwtParts | null {
  const t = token.replace(/^Bearer\s+/i, '').trim();
  const parts = t.split('.');
  if (parts.length !== 3) return null;
  const header = fromBase64(parts[0]);
  const payload = fromBase64(parts[1]);
  if (!header || !payload) return null;
  return { header, payload, signature: parts[2] };
}

export function encodeJwt(header: object, payload: object, signature: string): string {
  const b64u = (o: object) => toBase64(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64u(header)}.${b64u(payload)}.${signature}`;
}

export const ENCODING_LABEL: Record<Encoding, string> = {
  url: 'URL %',
  base64: 'Base64',
  html: 'HTML &#',
  hex: 'Hex \\x',
};
