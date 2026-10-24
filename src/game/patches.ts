import type { AttackClass } from './types';

export type PatchKind = 'fix' | 'bypassable' | 'breaks';

export interface PatchOption {
  kind: PatchKind;
  diff: string;
  why: string;
}

/**
 * One pull request to review. The player first says whether the code is vulnerable, then
 * names the class, then picks the one real fix out of three. Every snippet is meant to be
 * a textbook case: the bug (or its absence) should be obvious to anyone who knows the class.
 */
export interface PatchDef {
  id: string;
  /** The bug in the code, or for safe snippets, the class it looks like at a glance. */
  cls: AttackClass;
  vulnerable: boolean;
  /** For vulnerable snippets this is ENDPOINT[cls], so a real fix makes those attacks harmless. */
  endpoint: string;
  title: string;
  lang: string;
  code: string;
  /** Why it is vulnerable, or why it is fine. */
  explain: string;
  /** Exactly one `fix` among three. Empty for safe snippets. */
  options: PatchOption[];
}

export const PATCHES: PatchDef[] = [
  // ----------------------------------------------------------------- SQLi
  {
    id: 'sqli-fstring',
    cls: 'sqli',
    vulnerable: true,
    endpoint: '/products',
    title: 'Product page: look up by id',
    lang: 'python',
    code: `def product(req):
    pid = req.args["id"]
    sql = f"SELECT * FROM products WHERE id = {pid}"
    return db.execute(sql).fetchone()`,
    explain: 'The id is pasted into the SQL string, so ?id=1 OR 1=1 becomes part of the query.',
    options: [
      {
        kind: 'fix',
        diff: `-    sql = f"SELECT * FROM products WHERE id = {pid}"
-    return db.execute(sql).fetchone()
+    sql = "SELECT * FROM products WHERE id = %s"
+    return db.execute(sql, (pid,)).fetchone()`,
        why: 'Parameterised query. The driver sends the id as data, never as SQL.',
      },
      {
        kind: 'bypassable',
        diff: `+    pid = pid.replace("'", "''")`,
        why: 'Escaping quotes does nothing in a numeric context. 1 OR 1=1 has no quotes at all.',
      },
      {
        kind: 'bypassable',
        diff: `+    if "union" in pid.lower():
+        abort(400)`,
        why: 'Blacklist. OR 1=1, SLEEP(5) and stacked queries never say UNION.',
      },
    ],
  },
  {
    id: 'sqli-concat',
    cls: 'sqli',
    vulnerable: true,
    endpoint: '/products',
    title: 'Products: filter by category',
    lang: 'js',
    code: `app.get("/products", async (req, res) => {
  const sql = "SELECT * FROM products WHERE category = '"
    + req.query.cat + "'";
  res.json(await db.query(sql));
});`,
    explain: "String concatenation into SQL. ?cat=' OR '1'='1 closes the quote and rewrites the WHERE clause.",
    options: [
      {
        kind: 'bypassable',
        diff: `-  res.json(await db.query(sql));
+  try { res.json(await db.query(sql)); }
+  catch { res.status(500).send("error"); }`,
        why: 'Hiding errors is not a fix. Blind and time-based SQLi work without any error message.',
      },
      {
        kind: 'fix',
        diff: `-  const sql = "SELECT * FROM products WHERE category = '"
-    + req.query.cat + "'";
-  res.json(await db.query(sql));
+  const sql = "SELECT * FROM products WHERE category = ?";
+  res.json(await db.query(sql, [req.query.cat]));`,
        why: 'Placeholder plus a bound parameter. The query shape is fixed before input arrives.',
      },
      {
        kind: 'bypassable',
        diff: `+  if (/select|drop/i.test(req.query.cat))
+    return res.sendStatus(400);`,
        why: "Keyword blacklist. ' OR '1'='1 dumps every row without either word.",
      },
    ],
  },

  // ------------------------------------------------------------------ XSS
  {
    id: 'xss-express',
    cls: 'xss',
    vulnerable: true,
    endpoint: '/search',
    title: 'Search: show the query in the heading',
    lang: 'js',
    code: `app.get("/search", (req, res) => {
  const q = req.query.q;
  res.send("<h1>Results for " + q + "</h1>"
    + renderResults(q));
});`,
    explain: 'Reflected XSS. The query goes into HTML with no encoding, so <img src=x onerror=...> runs.',
    options: [
      {
        kind: 'bypassable',
        diff: `-  const q = req.query.q;
+  const q = req.query.q.replace(/<script>/gi, "");`,
        why: 'Strips one tag. <img onerror>, <svg onload> and <scr<script>ipt> still run.',
      },
      {
        kind: 'bypassable',
        diff: `+  res.set("X-XSS-Protection", "1; mode=block");`,
        why: 'Modern browsers ignore this header. The XSS auditor it controlled was removed years ago.',
      },
      {
        kind: 'fix',
        diff: `-  res.send("<h1>Results for " + q + "</h1>"
+  res.send("<h1>Results for " + escapeHtml(q) + "</h1>"`,
        why: 'HTML-encode on output. < > " \' & become entities, so the browser shows text, not tags.',
      },
    ],
  },
  {
    id: 'xss-innerhtml',
    cls: 'xss',
    vulnerable: true,
    endpoint: '/search',
    title: 'Greet the user by name',
    lang: 'js',
    code: `const name = new URLSearchParams(location.search).get("name");
document.querySelector("#greeting").innerHTML =
  "Welcome back, " + name;`,
    explain: 'DOM XSS. A URL parameter goes straight into innerHTML, which parses it as markup.',
    options: [
      {
        kind: 'fix',
        diff: `-document.querySelector("#greeting").innerHTML =
+document.querySelector("#greeting").textContent =`,
        why: 'textContent never parses HTML. The name is shown as plain text.',
      },
      {
        kind: 'bypassable',
        diff: `-  "Welcome back, " + name;
+  "Welcome back, " + name.replace(/script/gi, "");`,
        why: 'innerHTML does not run <script> anyway. <img src=x onerror=alert(1)> is the real payload.',
      },
      {
        kind: 'bypassable',
        diff: `-  "Welcome back, " + name;
+  "Welcome back, " + decodeURIComponent(name);`,
        why: 'Decoding is the opposite of encoding. The payload arrives just as live.',
      },
    ],
  },
  {
    id: 'xss-php',
    cls: 'xss',
    vulnerable: true,
    endpoint: '/search',
    title: 'Legacy search page',
    lang: 'php',
    code: `<?php $q = $_GET['q']; ?>
<p>You searched for: <?= $q ?></p>`,
    explain: 'Reflected XSS. <?= prints the raw parameter into the page.',
    options: [
      {
        kind: 'bypassable',
        diff: `-<?php $q = $_GET['q']; ?>
+<?php $q = addslashes($_GET['q']); ?>`,
        why: 'addslashes is SQL-era escaping. It adds backslashes to quotes and leaves < > alone.',
      },
      {
        kind: 'fix',
        diff: `-<p>You searched for: <?= $q ?></p>
+<p>You searched for: <?= htmlspecialchars($q, ENT_QUOTES, 'UTF-8') ?></p>`,
        why: 'htmlspecialchars with ENT_QUOTES is the textbook HTML encoder for PHP.',
      },
      {
        kind: 'breaks',
        diff: `-<p>You searched for: <?= $q ?></p>
+<p>You searched for: <?= urlencode($q) ?></p>`,
        why: 'Safe here, but wrong encoder. Every search for "red shoes" now reads red+shoes.',
      },
    ],
  },

  // ------------------------------------------------------------ Traversal
  {
    id: 'traversal-node',
    cls: 'traversal',
    vulnerable: true,
    endpoint: '/download',
    title: 'Invoices: download by filename',
    lang: 'js',
    code: `app.get("/download", (req, res) => {
  const file = path.join("/var/www/files", req.query.file);
  res.sendFile(file);
});`,
    explain: 'path.join happily resolves ../, so ?file=../../../etc/passwd walks out of the folder.',
    options: [
      {
        kind: 'bypassable',
        diff: `-  const file = path.join("/var/www/files", req.query.file);
+  const name = req.query.file.replace("../", "");
+  const file = path.join("/var/www/files", name);`,
        why: 'Replaces only the first ../, and only once. ....// collapses back into ../.',
      },
      {
        kind: 'fix',
        diff: `-  const file = path.join("/var/www/files", req.query.file);
+  const root = "/var/www/files/";
+  const file = path.resolve(root, req.query.file);
+  if (!file.startsWith(root)) return res.sendStatus(403);`,
        why: 'Resolve to an absolute path first, then check it is still inside the root.',
      },
      {
        kind: 'breaks',
        diff: `+  if (req.query.file.includes(".")) return res.sendStatus(403);`,
        why: 'Blocks ../ and also every filename with an extension. invoice.pdf is now a 403.',
      },
    ],
  },
  {
    id: 'traversal-python',
    cls: 'traversal',
    vulnerable: true,
    endpoint: '/download',
    title: 'Attachments: read from disk',
    lang: 'python',
    code: `BASE = "/var/www/files"

def download(req):
    name = req.args["file"]
    return open(os.path.join(BASE, name), "rb").read()`,
    explain: 'Classic traversal: ../../etc/passwd climbs out, and an absolute name like /etc/passwd makes os.path.join drop BASE entirely.',
    options: [
      {
        kind: 'bypassable',
        diff: `+    if name.startswith("/"):
+        abort(400)`,
        why: 'Stops absolute paths only. ../../etc/passwd does not start with a slash.',
      },
      {
        kind: 'bypassable',
        diff: `+    name = name.replace("../", "")`,
        why: 'Not recursive. ....// becomes ../ after one pass.',
      },
      {
        kind: 'fix',
        diff: `-    return open(os.path.join(BASE, name), "rb").read()
+    full = os.path.realpath(os.path.join(BASE, name))
+    if os.path.commonpath([full, BASE]) != BASE:
+        abort(403)
+    return open(full, "rb").read()`,
        why: 'Canonicalise with realpath, then confirm the result is still under BASE.',
      },
    ],
  },

  // ----------------------------------------------------------------- CMDi
  {
    id: 'cmdi-popen',
    cls: 'cmdi',
    vulnerable: true,
    endpoint: '/tools/ping',
    title: 'Ops tool: ping a host',
    lang: 'python',
    code: `def ping(req):
    host = req.args["host"]
    return os.popen(f"ping -c 1 {host}").read()`,
    explain: 'The host goes into a shell command line. ?host=8.8.8.8;id runs a second command.',
    options: [
      {
        kind: 'bypassable',
        diff: `-    return os.popen(f"ping -c 1 {host}").read()
+    return os.popen(f'ping -c 1 "{host}"').read()`,
        why: 'Double quotes do not stop the shell. $(id) and backticks still expand inside them.',
      },
      {
        kind: 'fix',
        diff: `-    return os.popen(f"ping -c 1 {host}").read()
+    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*", host):
+        abort(400)
+    return subprocess.run(["ping", "-c", "1", host],
+                          capture_output=True).stdout`,
        why: 'No shell at all: an argv list, plus an allow-list so the host cannot start with a dash.',
      },
      {
        kind: 'bypassable',
        diff: `+    host = host.replace(";", "")`,
        why: 'Only semicolons. |, &&, $( ) and backticks all still chain commands.',
      },
    ],
  },
  {
    id: 'cmdi-exec',
    cls: 'cmdi',
    vulnerable: true,
    endpoint: '/tools/ping',
    title: 'Ops tool: DNS lookup',
    lang: 'js',
    code: `app.get("/tools/ping", (req, res) => {
  exec("nslookup " + req.query.host, (err, out) => {
    res.type("text").send(out);
  });
});`,
    explain: 'exec runs through /bin/sh, so shell metacharacters in host become commands.',
    options: [
      {
        kind: 'fix',
        diff: `-  exec("nslookup " + req.query.host, (err, out) => {
+  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(req.query.host)) return res.sendStatus(400);
+  execFile("nslookup", [req.query.host], (err, out) => {`,
        why: 'execFile skips the shell and passes host as one argument. The allow-list keeps it a hostname, not a flag.',
      },
      {
        kind: 'bypassable',
        diff: `-  exec("nslookup " + req.query.host, (err, out) => {
+  const host = req.query.host.split(" ")[0];
+  exec("nslookup " + host, (err, out) => {`,
        why: 'Commands do not need spaces. example.com;id or $(id) survives the split.',
      },
      {
        kind: 'bypassable',
        diff: `+// deploy: run this service as user "nobody"`,
        why: 'Least privilege limits the damage, but the attacker still runs commands as nobody.',
      },
    ],
  },

  // ----------------------------------------------------------------- SSRF
  {
    id: 'ssrf-requests',
    cls: 'ssrf',
    vulnerable: true,
    endpoint: '/api/v2/webhooks',
    title: 'Webhooks: verify partner URL',
    lang: 'python',
    code: `def verify_webhook(req):
    url = req.json["url"]
    r = requests.get(url, timeout=5)
    return {"status": r.status_code}`,
    explain: 'The server fetches any URL it is given, including http://169.254.169.254/ and internal admin panels.',
    options: [
      {
        kind: 'bypassable',
        diff: `+    if "169.254.169.254" in url or "localhost" in url:
+        abort(400)`,
        why: 'String blacklist. 127.1, 0x7f000001, [::1] and a DNS name pointing inside all get past.',
      },
      {
        kind: 'bypassable',
        diff: `+    if not url.startswith("https://partner.example"):
+        abort(400)`,
        why: 'Prefix check on a string. https://partner.example.evil.tld/ and https://partner.example@10.0.0.5/ both pass.',
      },
      {
        kind: 'fix',
        diff: `+    u = urlparse(url)
+    if u.scheme != "https" or u.hostname not in PARTNER_HOSTS:
+        abort(400)
-    r = requests.get(url, timeout=5)
+    r = requests.get(url, timeout=5, allow_redirects=False)`,
        why: 'Parse the URL, allow-list the exact hostname, and do not follow redirects to somewhere else.',
      },
    ],
  },

  // ------------------------------------------------------------- Redirect
  {
    id: 'redirect-next',
    cls: 'redirect',
    vulnerable: true,
    endpoint: '/auth/callback',
    title: 'Login: return to the previous page',
    lang: 'js',
    code: `app.get("/auth/callback", async (req, res) => {
  await finishLogin(req);
  res.redirect(req.query.next || "/");
});`,
    explain: 'Open redirect. ?next=https://evil.tld sends a freshly logged-in user anywhere.',
    options: [
      {
        kind: 'bypassable',
        diff: `+  if (!req.query.next?.startsWith("/")) return res.redirect("/");`,
        why: 'Protocol-relative //evil.tld starts with a slash too, and browsers treat it as another site.',
      },
      {
        kind: 'fix',
        diff: `-  res.redirect(req.query.next || "/");
+  const next = String(req.query.next || "/");
+  const local = /^\\/(?![\\/\\\\])/.test(next);
+  res.redirect(local ? next : "/");`,
        why: 'Only a single leading slash followed by a path. // and /\\ are rejected.',
      },
      {
        kind: 'bypassable',
        diff: `+  if (!req.query.next?.includes("hypercart.io")) return res.redirect("/");`,
        why: 'Substring check. https://evil.tld/?hypercart.io contains it too.',
      },
    ],
  },

  // ----------------------------------------------------------------- SSTI
  {
    id: 'ssti-flask',
    cls: 'ssti',
    vulnerable: true,
    endpoint: '/api/v2/render',
    title: 'Emails: personalised greeting',
    lang: 'python',
    code: `def render(req):
    name = req.json["name"]
    return render_template_string(
        "<p>Hello " + name + ", welcome to Hypercart!</p>")`,
    explain: 'The name becomes template source. {{7*7}} renders 49, and from there it is code execution.',
    options: [
      {
        kind: 'fix',
        diff: `-    return render_template_string(
-        "<p>Hello " + name + ", welcome to Hypercart!</p>")
+    return render_template_string(
+        "<p>Hello {{ name }}, welcome to Hypercart!</p>", name=name)`,
        why: 'The template is fixed and the name is passed in as data. Jinja autoescapes it too.',
      },
      {
        kind: 'bypassable',
        diff: `+    name = name.replace("{{", "").replace("}}", "")`,
        why: 'Jinja has other syntax. {% ... %} blocks still execute.',
      },
      {
        kind: 'breaks',
        diff: `+    if not name.isalpha():
+        abort(400)`,
        why: 'Safe, but Mary-Jane, José and anyone with a space in their name can no longer sign up.',
      },
    ],
  },

  // ------------------------------------------------------------------ XXE
  {
    id: 'xxe-java',
    cls: 'xxe',
    vulnerable: true,
    endpoint: '/api/v2/invoices',
    title: 'Invoices: import XML',
    lang: 'java',
    code: `var f = DocumentBuilderFactory.newInstance();
Document doc = f.newDocumentBuilder()
    .parse(req.getInputStream());`,
    explain: 'The default Java parser accepts a DOCTYPE and resolves external entities like file:///etc/passwd.',
    options: [
      {
        kind: 'bypassable',
        diff: `+Schema s = schemaFactory.newSchema(INVOICE_XSD);
+s.newValidator().validate(new DOMSource(doc));`,
        why: 'Validation runs after parsing. The entity has already been fetched by then.',
      },
      {
        kind: 'fix',
        diff: `+f.setFeature(
+    "http://apache.org/xml/features/disallow-doctype-decl", true);
 Document doc = f.newDocumentBuilder()`,
        why: 'No DOCTYPE, no entities. This is the OWASP-recommended setting.',
      },
      {
        kind: 'bypassable',
        diff: `+String xml = read(req);
+if (xml.contains("file://")) throw new BadRequest();`,
        why: 'Blacklist. http://, jar: and parameter entities still work, and so does UTF-16.',
      },
    ],
  },
  {
    id: 'xxe-lxml',
    cls: 'xxe',
    vulnerable: true,
    endpoint: '/api/v2/invoices',
    title: 'Invoices: parse supplier XML',
    lang: 'python',
    code: `parser = etree.XMLParser(resolve_entities=True)
doc = etree.fromstring(req.body, parser)`,
    explain: 'resolve_entities=True expands external entities, so a DOCTYPE can pull in local files.',
    options: [
      {
        kind: 'bypassable',
        diff: `-parser = etree.XMLParser(resolve_entities=True)
+parser = etree.XMLParser(resolve_entities=True, no_network=True)`,
        why: 'Blocks network fetches only. file:///etc/passwd is not the network.',
      },
      {
        kind: 'breaks',
        diff: `-doc = etree.fromstring(req.body, parser)
+doc = json.loads(req.body)`,
        why: 'Suppliers send XML. Every invoice upload now fails with a JSON error.',
      },
      {
        kind: 'fix',
        diff: `-parser = etree.XMLParser(resolve_entities=True)
-doc = etree.fromstring(req.body, parser)
+doc = defusedxml.ElementTree.fromstring(req.body)`,
        why: 'defusedxml refuses entities and DTD tricks out of the box.',
      },
    ],
  },

  // ------------------------------------------------------------------ JWT
  {
    id: 'jwt-alg',
    cls: 'jwt',
    vulnerable: true,
    endpoint: '/api/v2/me',
    title: 'Auth: support more token types',
    lang: 'js',
    code: `const header = JSON.parse(b64decode(token.split(".")[0]));
const claims = jwt.verify(token, SECRET, {
  algorithms: [header.alg],
});`,
    explain: 'The token picks its own algorithm. alg: none, or HS256 signed with a public key, gets verified.',
    options: [
      {
        kind: 'bypassable',
        diff: `+if (header.alg === "none") throw new Error("nope");`,
        why: 'Case-sensitive, and only one trick. None, nOnE and RS/HS key confusion still work.',
      },
      {
        kind: 'fix',
        diff: `-  algorithms: [header.alg],
+  algorithms: ["HS256"],`,
        why: 'Pin the algorithm on the server. The token never gets a vote.',
      },
      {
        kind: 'breaks',
        diff: `-  algorithms: [header.alg],
+  algorithms: ["RS256"],`,
        why: 'Our tokens are HS256 with a shared secret. Every real login now fails.',
      },
    ],
  },
  {
    id: 'jwt-decode',
    cls: 'jwt',
    vulnerable: true,
    endpoint: '/api/v2/me',
    title: 'Admin: read role from token',
    lang: 'js',
    code: `const claims = jwt.decode(req.cookies.session);
if (claims.role !== "admin") return res.sendStatus(403);`,
    explain: 'jwt.decode only base64-decodes. Nobody checks the signature, so anyone can write role: admin.',
    options: [
      {
        kind: 'bypassable',
        diff: `+if (claims.exp * 1000 < Date.now()) return res.sendStatus(401);`,
        why: 'Checks expiry of an unsigned token. The attacker just sets exp too.',
      },
      {
        kind: 'bypassable',
        diff: `-const claims = jwt.decode(req.cookies.session);
+const claims = jwt.decode(req.cookies.session, { complete: true }).payload;`,
        why: 'Still decode. complete: true returns the header as well, and verifies nothing.',
      },
      {
        kind: 'fix',
        diff: `-const claims = jwt.decode(req.cookies.session);
+const claims = jwt.verify(req.cookies.session, SECRET, {
+  algorithms: ["HS256"],
+});`,
        why: 'verify checks the signature (with a pinned algorithm) before trusting any claim.',
      },
    ],
  },

  // ---------------------------------------------- Safe code that looks scary
  {
    id: 'safe-sqli-param',
    cls: 'sqli',
    vulnerable: false,
    endpoint: '/orders',
    title: 'Orders: look up by customer',
    lang: 'python',
    code: `def orders(req):
    cid = req.args["customer"]
    return db.execute(
        "SELECT * FROM orders WHERE customer_id = %s", (cid,)
    ).fetchall()`,
    explain: 'Already parameterised. %s is a driver placeholder and cid is passed separately, not formatted in.',
    options: [],
  },
  {
    id: 'safe-xss-textcontent',
    cls: 'xss',
    vulnerable: false,
    endpoint: '/account',
    title: 'Account: show display name',
    lang: 'js',
    code: `const name = new URLSearchParams(location.search).get("name");
document.querySelector("#greeting").textContent =
  "Welcome back, " + name;`,
    explain: 'textContent never parses HTML. Whatever is in the URL shows up as plain text.',
    options: [],
  },
  {
    id: 'safe-xss-react',
    cls: 'xss',
    vulnerable: false,
    endpoint: '/reviews',
    title: 'Reviews: render comment body',
    lang: 'jsx',
    code: `function Review({ review }) {
  return <p className="review">{review.body}</p>;
}`,
    explain: 'React escapes text in {} by default. Only dangerouslySetInnerHTML would be a problem.',
    options: [],
  },
  {
    id: 'safe-traversal-flask',
    cls: 'traversal',
    vulnerable: false,
    endpoint: '/avatars',
    title: 'Avatars: serve uploaded image',
    lang: 'python',
    code: `def avatar(req):
    name = req.args["file"]
    return send_from_directory("/var/www/avatars", name)`,
    explain: "Flask's send_from_directory uses safe_join and rejects anything that escapes the folder.",
    options: [],
  },
  {
    id: 'safe-cmdi-execfile',
    cls: 'cmdi',
    vulnerable: false,
    endpoint: '/tools/backup',
    title: 'Ops tool: archive a fixed folder',
    lang: 'js',
    code: `app.post("/tools/backup", (req, res) => {
  execFile("tar", ["-czf", "/backups/site.tgz", "/var/www"],
    (err) => res.sendStatus(err ? 500 : 204));
});`,
    explain: 'No user input reaches the command, and execFile does not use a shell anyway.',
    options: [],
  },
  {
    id: 'safe-redirect-map',
    cls: 'redirect',
    vulnerable: false,
    endpoint: '/auth/logout',
    title: 'Logout: send user to a known page',
    lang: 'js',
    code: `const PAGES = new Map([["home", "/"], ["cart", "/cart"]]);

app.get("/auth/logout", (req, res) => {
  res.redirect(PAGES.get(req.query.to) ?? "/");
});`,
    explain: 'The input only picks a key from a fixed map of local paths. Anything else goes home.',
    options: [],
  },
  {
    id: 'safe-jwt-verify',
    cls: 'jwt',
    vulnerable: false,
    endpoint: '/api/v2/orders',
    title: 'Auth: check session token',
    lang: 'js',
    code: `const claims = jwt.verify(req.cookies.session, SECRET, {
  algorithms: ["HS256"],
});`,
    explain: 'Signature verified with a server-side secret and a pinned algorithm. Textbook.',
    options: [],
  },
  {
    id: 'safe-ssti-file',
    cls: 'ssti',
    vulnerable: false,
    endpoint: '/api/v2/welcome',
    title: 'Emails: welcome template',
    lang: 'python',
    code: `def welcome(req):
    return render_template("welcome.html",
                           name=req.json["name"])`,
    explain: 'The template is a file on disk and the name is passed in as a variable. Input never becomes template code.',
    options: [],
  },
  {
    id: 'safe-xxe-defused',
    cls: 'xxe',
    vulnerable: false,
    endpoint: '/api/v2/receipts',
    title: 'Receipts: parse XML upload',
    lang: 'python',
    code: `from defusedxml.ElementTree import fromstring

def receipt(req):
    doc = fromstring(req.body)
    return {"total": doc.findtext("total")}`,
    explain: 'defusedxml blocks external entities and entity expansion bombs by default.',
    options: [],
  },
];
