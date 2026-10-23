import { baseDraft, getHeader, hex, internalIp, legitIpInfo, setHeader, withBody, type Draft } from './draft';
import type { Rng } from './rng';
import type { HttpRequest } from './types';

export interface DirectiveDef {
  id: string;
  title: string;
  text: string;
  violates(req: HttpRequest): boolean;
  /** A request that breaks the directive. */
  violate(rng: Rng): Draft;
  /** Make any other draft comply, so only `violate` drafts break it. */
  comply?(d: Draft, rng: Rng): void;
  /** Legit request that looks like a violation but isn't. */
  lookalike?(rng: Rng): Draft;
}

const header = (req: HttpRequest, key: string) => req.headers.find((h) => h.key?.toLowerCase() === key.toLowerCase());

function violation(d: Draft, explain: string): Draft {
  d.truth = { malicious: true, cls: 'policy', explain };
  return d;
}

function lookalike(d: Draft, explain: string): Draft {
  d.truth = { malicious: false, bait: true, explain };
  return d;
}

export const DIRECTIVES: DirectiveDef[] = [
  {
    id: 'admin-internal',
    title: 'Admin is internal',
    text: '/admin only from the office network 10.0.0.0/8.',
    violates: (r) => r.path.plain.startsWith('/admin') && !r.ip.plain.startsWith('10.'),
    violate: (rng) => violation(baseDraft(rng, 'GET', rng.pick(['/admin', '/admin/users', '/admin/export'])), '/admin from the public internet. Directive says office network only.'),
    comply: (d, rng) => {
      if (d.path.startsWith('/admin')) {
        d.ip = internalIp(rng);
        d.ipInfo = { asn: 'internal', country: 'LAN', reputation: 'clean', seen: 4, internal: true };
      }
    },
    lookalike: (rng) => {
      const d = baseDraft(rng, 'GET', rng.pick(['/admin', '/admin/orders']));
      d.ip = internalIp(rng);
      d.ipInfo = { asn: 'internal', country: 'LAN', reputation: 'clean', seen: 4, internal: true };
      return lookalike(d, 'Admin panel from 10.x, the office network. Allowed.');
    },
  },
  {
    id: 'v1-deprecated',
    title: 'Kill API v1',
    text: 'API v1 is deprecated. Block every /api/v1/* call.',
    violates: (r) => r.path.plain.startsWith('/api/v1/'),
    violate: (rng) => {
      const d = baseDraft(rng, 'GET', '/api/v1/' + rng.pick(['orders', 'users/me', 'export', 'products']));
      setHeader(d, 'User-Agent', 'HypercartApp/2.0.3 (Android 9)');
      return violation(d, 'Ancient app still calling /api/v1. Deprecated means blocked.');
    },
    comply: (d) => {
      d.path = d.path.replace(/^\/api\/v1\//, '/api/v2/');
    },
  },
  {
    id: 'freedonia',
    title: 'Freedonia embargo',
    text: 'Sanctions: no traffic from Freedonia (country FD). Use IP lookup.',
    violates: (r) => r.ipInfo.country === 'FD',
    violate: (rng) => {
      const d = baseDraft(rng, 'GET', rng.pick(['/', '/products', '/deals']));
      d.ipInfo = { ...legitIpInfo(rng), country: 'FD', asn: 'AS31337 Freedonia Telecom' };
      return violation(d, 'IP is in Freedonia. Embargoed, however nice the shopper.');
    },
    comply: (d) => {
      if (d.ipInfo.country === 'FD') d.ipInfo.country = 'DE';
    },
  },
  {
    id: 'no-trace',
    title: 'No TRACE',
    text: 'Block TRACE and TRACK methods (cross-site tracing).',
    violates: (r) => r.method.plain === 'TRACE' || r.method.plain === 'TRACK',
    violate: (rng) => violation(baseDraft(rng, rng.pick(['TRACE', 'TRACK']), '/'), 'TRACE method. Banned by directive.'),
  },
  {
    id: 'ua-required',
    title: 'No faceless clients',
    text: 'Requests without a User-Agent header are blocked.',
    violates: (r) => !header(r, 'User-Agent'),
    violate: (rng) => {
      const d = baseDraft(rng, 'GET', rng.pick(['/', '/products', '/api/v2/orders']));
      setHeader(d, 'User-Agent', null);
      return violation(d, 'No User-Agent at all. Directive says block.');
    },
    comply: (d, rng) => {
      if (!getHeader(d, 'User-Agent')) setHeader(d, 'User-Agent', `curl/8.${rng.int(0, 9)}.0`);
    },
  },
  {
    id: 'debug-param',
    title: 'Debug is off',
    text: 'Block any request with a debug=true (or debug=1) parameter.',
    violates: (r) => r.query.some((q) => q.key === 'debug' && /^(true|1)$/i.test(q.plain)),
    violate: (rng) => {
      const d = baseDraft(rng, 'GET', rng.pick(['/products', '/search', '/api/v2/orders']));
      d.query.push(['id', `${rng.int(1, 300)}`], ['debug', rng.pick(['true', '1'])]);
      return violation(d, 'debug=true could dump stack traces. Directive says block.');
    },
    comply: (d) => {
      d.query = d.query.filter(([k]) => k !== 'debug');
    },
    lookalike: (rng) => {
      const d = baseDraft(rng, 'GET', '/search');
      d.query.push(['q', 'debug probe usb'], ['debug', 'false']);
      return lookalike(d, 'debug=false is fine, and searching for "debug" is fine.');
    },
  },
  {
    id: 'tor',
    title: 'No Tor checkout',
    text: 'Block Tor exit nodes (IP reputation "tor").',
    violates: (r) => r.ipInfo.reputation === 'tor',
    violate: (rng) => {
      const d = baseDraft(rng, 'POST', '/checkout');
      withBody(d, 'application/json', JSON.stringify({ cart: hex(rng, 8), card: '**** ' + rng.int(1000, 9999) }));
      d.ipInfo = { ...legitIpInfo(rng), reputation: 'tor', asn: 'AS60729 Tor exit' };
      return violation(d, 'Checkout from a Tor exit node. Fraud team said no.');
    },
    comply: (d) => {
      if (d.ipInfo.reputation === 'tor') d.ipInfo.reputation = 'suspicious';
    },
  },
  {
    id: 'billing-freeze',
    title: 'Billing freeze',
    text: 'Billing migration: block POST to /billing/*. GET is fine.',
    violates: (r) => r.method.plain === 'POST' && r.path.plain.startsWith('/billing'),
    violate: (rng) => {
      const d = baseDraft(rng, 'POST', rng.pick(['/billing/charge', '/billing/plan']));
      withBody(d, 'application/json', JSON.stringify({ plan: rng.pick(['pro', 'team']) }));
      return violation(d, 'POST to /billing during the freeze.');
    },
    lookalike: (rng) => lookalike(baseDraft(rng, 'GET', '/billing/invoices'), 'GET on /billing is still allowed.'),
  },
  {
    id: 'upload-limit',
    title: '10 MB uploads',
    text: 'Uploads larger than 10 MB (Content-Length > 10485760) are blocked.',
    violates: (r) => r.path.plain.startsWith('/upload') && Number(header(r, 'Content-Length')?.plain ?? 0) > 10485760,
    violate: (rng) => {
      const d = baseDraft(rng, 'POST', '/upload');
      d.body = '<binary data>';
      setHeader(d, 'Content-Type', 'video/mp4');
      setHeader(d, 'Content-Length', String(rng.int(11, 400) * 1048576));
      d.keepLength = true;
      return violation(d, 'Upload way over the 10 MB limit.');
    },
    lookalike: (rng) => {
      const d = baseDraft(rng, 'POST', '/upload');
      d.body = '<binary data>';
      setHeader(d, 'Content-Type', 'image/png');
      setHeader(d, 'Content-Length', String(rng.int(200, 9000) * 1024));
      d.keepLength = true;
      return lookalike(d, 'Upload under 10 MB. Allowed.');
    },
  },
  {
    id: 'api-key',
    title: 'API keys required',
    text: 'Every /api/v2/* request needs an X-Api-Key header.',
    violates: (r) => r.path.plain.startsWith('/api/v2/') && !header(r, 'X-Api-Key'),
    violate: (rng) => {
      const d = baseDraft(rng, 'GET', '/api/v2/' + rng.pick(['orders', 'products', 'customers']));
      return violation(d, '/api/v2 call without an X-Api-Key.');
    },
    comply: (d, rng) => {
      if (d.path.startsWith('/api/v2/') && !getHeader(d, 'X-Api-Key')) setHeader(d, 'X-Api-Key', `hc_live_${hex(rng, 16)}`);
    },
  },
];

export function directiveById(id: string): DirectiveDef {
  const d = DIRECTIVES.find((x) => x.id === id);
  if (!d) throw new Error(`unknown directive ${id}`);
  return d;
}
