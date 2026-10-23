import { encodeLayers } from './encoding';
import type { DifficultyConfig } from './difficulty';
import type { Rng } from './rng';
import type { Encoding, Field, FieldKind, HttpRequest, IpInfo, Reputation, Truth } from './types';

/** A value that the generator may wrap in encoding layers. */
export interface Payload {
  v: string;
  enc: true;
}

export type Val = string | Payload;

export const P = (v: string): Payload => ({ v, enc: true });

/** Mutable request description that templates and directives edit before it is built. */
export interface Draft {
  method: string;
  path: string;
  query: [string, Val][];
  headers: [string, Val][];
  body?: Val;
  ip: string;
  ipInfo: IpInfo;
  rate: number[];
  note?: string;
  /** Keep a hand-written Content-Length (request smuggling needs a lying one). */
  keepLength?: boolean;
  truth: Truth;
}

export const HOST = 'shop.hypercart.io';

const UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'HypercartApp/4.2.1 (iOS 18.1)',
];

const COUNTRIES = ['US', 'DE', 'UA', 'PL', 'GB', 'FR', 'BR', 'IN', 'JP', 'NL', 'CA', 'SE'];

const ISP_ASNS = [
  'AS7922 Comcast',
  'AS3320 Deutsche Telekom',
  'AS15895 Kyivstar',
  'AS5089 Virgin Media',
  'AS3215 Orange',
  'AS2856 BT',
  'AS4713 NTT',
  'AS7018 AT&T',
  'AS5617 Orange Polska',
];

export const CLOUD_ASNS = [
  'AS16509 Amazon',
  'AS14061 DigitalOcean',
  'AS24940 Hetzner',
  'AS63949 Linode',
  'AS20473 Vultr',
  'AS9009 M247',
];

export function randomUa(rng: Rng): string {
  return rng.pick(UAS);
}

export function publicIp(rng: Rng): string {
  let a: number;
  do a = rng.int(11, 223);
  while (a === 127 || a === 172 || a === 192 || a === 169 || a === 100);
  return `${a}.${rng.int(0, 255)}.${rng.int(0, 255)}.${rng.int(1, 254)}`;
}

export function internalIp(rng: Rng): string {
  return `10.${rng.int(0, 40)}.${rng.int(0, 255)}.${rng.int(1, 254)}`;
}

export function hex(rng: Rng, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += '0123456789abcdef'[rng.int(0, 15)];
  return s;
}

export function quietRate(rng: Rng): number[] {
  return Array.from({ length: 12 }, () => (rng.chance(0.6) ? 0 : rng.int(1, 2)));
}

export function noisyRate(rng: Rng, peak: number): number[] {
  return Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round(peak * (0.5 + rng.next() * 0.6) * (i > 3 ? 1 : 0.4))));
}

export function legitIpInfo(rng: Rng): IpInfo {
  return {
    asn: rng.chance(0.85) ? rng.pick(ISP_ASNS) : rng.pick(CLOUD_ASNS),
    country: rng.pick(COUNTRIES),
    reputation: rng.chance(0.85) ? 'clean' : 'unknown',
    seen: rng.int(1, 6),
    internal: false,
  };
}

export function attackIpInfo(rng: Rng, cfg: DifficultyConfig): IpInfo {
  const tell = rng.chance(cfg.reputationTells);
  const reputation: Reputation = tell ? rng.pick(['malicious', 'suspicious', 'malicious', 'tor'] as const) : rng.pick(['clean', 'unknown'] as const);
  return {
    asn: rng.chance(0.7) ? rng.pick(CLOUD_ASNS) : rng.pick(ISP_ASNS),
    country: rng.pick(COUNTRIES),
    reputation,
    seen: rng.int(1, 30),
    internal: false,
  };
}

/** A plain browser request; templates overwrite what they need. */
export function baseDraft(rng: Rng, method: string, path: string): Draft {
  const headers: [string, Val][] = [
    ['Host', HOST],
    ['User-Agent', randomUa(rng)],
    ['Accept', method === 'GET' ? 'text/html,application/json;q=0.9' : 'application/json'],
    ['Cookie', `session=${hex(rng, 24)}`],
  ];
  return {
    method,
    path,
    query: [],
    headers,
    ip: publicIp(rng),
    ipInfo: legitIpInfo(rng),
    rate: quietRate(rng),
    truth: { malicious: false, explain: 'Regular customer traffic.' },
  };
}

export function setHeader(d: Draft, key: string, value: Val | null): void {
  const i = d.headers.findIndex(([k]) => k.toLowerCase() === key.toLowerCase());
  if (value === null) {
    if (i >= 0) d.headers.splice(i, 1);
  } else if (i >= 0) d.headers[i] = [d.headers[i][0], value];
  else d.headers.push([key, value]);
}

export function getHeader(d: Draft, key: string): string | undefined {
  const h = d.headers.find(([k]) => k.toLowerCase() === key.toLowerCase());
  return h ? valText(h[1]) : undefined;
}

export function valText(v: Val): string {
  return typeof v === 'string' ? v : v.v;
}

export function withBody(d: Draft, contentType: string, body: Val): Draft {
  d.body = body;
  setHeader(d, 'Content-Type', contentType);
  setHeader(d, 'Content-Length', String(new TextEncoder().encode(valText(body)).length));
  return d;
}

export function formBody(pairs: [string, string][]): string {
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

function chooseLayers(rng: Rng, cfg: DifficultyConfig, malicious: boolean): Encoding[] {
  // Legit values get light encoding too, so encoding on its own is never a tell.
  const max = malicious ? cfg.maxLayers : Math.min(1, cfg.maxLayers);
  const roll = rng.next();
  let n = 0;
  if (cfg.maxLayers === 1) n = roll < 0.5 ? 1 : 0;
  else if (roll < 0.25) n = 0;
  else n = rng.int(1, max);
  const out: Encoding[] = [];
  for (let i = 0; i < n; i++) out.push(rng.pick(cfg.encodings));
  return out;
}

let fieldSeq = 0;

function field(kind: FieldKind, key: string | undefined, plain: string, layers: Encoding[]): Field {
  return { id: `f${++fieldSeq}`, kind, key, plain, layers, raw: encodeLayers(plain, layers) };
}

function buildVal(kind: FieldKind, key: string | undefined, v: Val, rng: Rng, cfg: DifficultyConfig, malicious: boolean): Field {
  if (typeof v === 'string') return field(kind, key, v, []);
  return field(kind, key, v.v, chooseLayers(rng, cfg, malicious));
}

let reqSeq = 0;

export function build(d: Draft, rng: Rng, cfg: DifficultyConfig): HttpRequest {
  const mal = d.truth.malicious;
  const body = d.body === undefined ? undefined : buildVal('body', undefined, d.body, rng, cfg, mal);
  const headers = d.headers.map(([k, v]) => buildVal('header', k, v, rng, cfg, mal));
  if (body) {
    // Keep Content-Length honest after encoding, unless a template set it on purpose.
    const cl = headers.find((h) => h.key === 'Content-Length');
    if (cl && cl.layers.length === 0 && !d.keepLength) {
      cl.plain = cl.raw = String(new TextEncoder().encode(body.raw).length);
    }
  }
  return {
    id: `r${++reqSeq}`,
    method: field('method', undefined, d.method, []),
    path: field('path', undefined, d.path, []),
    query: d.query.map(([k, v]) => buildVal('query', k, v, rng, cfg, mal)),
    headers,
    body,
    ip: field('ip', undefined, d.ip, []),
    ipInfo: d.ipInfo,
    rate: d.rate,
    note: d.note,
    truth: d.truth,
  };
}
