import type { AttackClass } from './types';

export type PatchKind = 'fix' | 'bypassable' | 'breaks';

export interface PatchOption {
  kind: PatchKind;
  diff: string;
  why: string;
}

export interface PatchDef {
  cls: AttackClass;
  endpoint: string;
  ticket: string;
  lang: string;
  code: string;
  options: PatchOption[];
}

export const PATCHES: PatchDef[] = [
  {
    cls: 'sqli',
    endpoint: '/products',
    ticket: 'products.py builds SQL with string formatting',
    lang: 'python',
    code: `def product(req):
    pid = req.args["id"]
    sql = f"SELECT * FROM products WHERE id = {pid}"
    return db.execute(sql).fetchone()`,
    options: [
      {
        kind: 'fix',
        diff: `-    sql = f"SELECT * FROM products WHERE id = {pid}"
-    return db.execute(sql).fetchone()
+    return db.execute(
+        "SELECT * FROM products WHERE id = %s", (int(pid),)
+    ).fetchone()`,
        why: 'Parameterised query plus an int cast. Input never becomes SQL.',
      },
      {
        kind: 'bypassable',
        diff: `+    if "UNION" in pid or "'" in pid:
+        abort(400)`,
        why: 'Blacklist. `union` in lowercase, or `1 OR 1=1` with no quote, sails through.',
      },
      {
        kind: 'breaks',
        diff: `-    pid = req.args["id"]
+    pid = req.args["id"].replace("1", "")`,
        why: 'Removes every 1 from product ids. Product 10, 11, 21... gone.',
      },
    ],
  },
  {
    cls: 'xss',
    endpoint: '/search',
    ticket: 'search.html echoes the query unescaped',
    lang: 'jinja',
    code: `<h1>Results for {{ q | safe }}</h1>
<ul>{% for p in results %}<li>{{ p.name }}</li>{% endfor %}</ul>`,
    options: [
      {
        kind: 'bypassable',
        diff: `-<h1>Results for {{ q | safe }}</h1>
+<h1>Results for {{ q | replace("<script>", "") | safe }}</h1>`,
        why: 'Strips one tag. `<img onerror>` and `<svg onload>` still run.',
      },
      {
        kind: 'fix',
        diff: `-<h1>Results for {{ q | safe }}</h1>
+<h1>Results for {{ q }}</h1>`,
        why: 'Drop `| safe` and let autoescaping encode < > " \' &.',
      },
      {
        kind: 'breaks',
        diff: `-<h1>Results for {{ q | safe }}</h1>
+<h1>Results for</h1>
+{% if q|length > 3 %}{% set results = [] %}{% endif %}`,
        why: 'Hides the query and empties results for anything over 3 chars. Search is now useless.',
      },
    ],
  },
  {
    cls: 'traversal',
    endpoint: '/download',
    ticket: 'download handler joins user input onto a path',
    lang: 'js',
    code: `app.get("/download", (req, res) => {
  const file = path.join("/var/www/files", req.query.file);
  res.sendFile(file);
});`,
    options: [
      {
        kind: 'bypassable',
        diff: `-  const file = path.join("/var/www/files", req.query.file);
+  const name = req.query.file.replace("../", "");
+  const file = path.join("/var/www/files", name);`,
        why: 'Single non-recursive replace. `....//` collapses back into `../`.',
      },
      {
        kind: 'breaks',
        diff: `-  res.sendFile(file);
+  if (file.includes(".")) return res.sendStatus(403);
+  res.sendFile(file);`,
        why: 'Every file has a dot. invoice.pdf now returns 403.',
      },
      {
        kind: 'fix',
        diff: `-  const file = path.join("/var/www/files", req.query.file);
+  const root = "/var/www/files/";
+  const file = path.resolve(root, req.query.file);
+  if (!file.startsWith(root)) return res.sendStatus(403);`,
        why: 'Resolve first, then check the result is still inside the root.',
      },
    ],
  },
  {
    cls: 'cmdi',
    endpoint: '/tools/ping',
    ticket: 'ping tool shells out with user input',
    lang: 'python',
    code: `def ping(req):
    host = req.args["host"]
    return os.popen(f"ping -c 1 {host}").read()`,
    options: [
      {
        kind: 'fix',
        diff: `-    return os.popen(f"ping -c 1 {host}").read()
+    if not re.fullmatch(r"[A-Za-z0-9.-]{1,253}", host):
+        abort(400)
+    return subprocess.run(["ping", "-c", "1", host],
+                          capture_output=True).stdout`,
        why: 'Allow-list the hostname and skip the shell entirely with an argv list.',
      },
      {
        kind: 'bypassable',
        diff: `+    host = host.replace(";", "")`,
        why: 'Only semicolons. `$(...)`, backticks, `|` and `&&` still work.',
      },
      {
        kind: 'breaks',
        diff: `-    return os.popen(f"ping -c 1 {host}").read()
+    return "pong"`,
        why: 'Safe, technically. Also a lie. Ops can no longer ping anything.',
      },
    ],
  },
  {
    cls: 'ssrf',
    endpoint: '/api/v2/webhooks',
    ticket: 'webhook verifier fetches any URL',
    lang: 'go',
    code: `func verify(w http.ResponseWriter, r *http.Request) {
    url := body(r).URL
    resp, _ := http.Get(url)
    w.WriteHeader(resp.StatusCode)
}`,
    options: [
      {
        kind: 'bypassable',
        diff: `+    if strings.Contains(url, "169.254") || strings.Contains(url, "localhost") {
+        http.Error(w, "nope", 400); return
+    }`,
        why: 'String checks. `0x7f000001`, `[::1]` and DNS rebinding all get past.',
      },
      {
        kind: 'fix',
        diff: `-    resp, _ := http.Get(url)
+    if !strings.HasPrefix(url, "https://") { http.Error(w, "https only", 400); return }
+    resp, err := safeClient.Get(url) // dialer refuses private, loopback, link-local IPs
+    if err != nil { http.Error(w, "blocked", 400); return }`,
        why: 'Check the resolved IP at connect time, not the string. HTTPS only.',
      },
      {
        kind: 'breaks',
        diff: `-    resp, _ := http.Get(url)
+    resp, _ := http.Get("https://hypercart.io/ok")`,
        why: 'Verifies our own homepage instead. Every partner webhook "works" and none do.',
      },
    ],
  },
  {
    cls: 'redirect',
    endpoint: '/auth/callback',
    ticket: 'login callback redirects to any `next`',
    lang: 'js',
    code: `app.get("/auth/callback", async (req, res) => {
  await finishLogin(req);
  res.redirect(req.query.next || "/");
});`,
    options: [
      {
        kind: 'fix',
        diff: `-  res.redirect(req.query.next || "/");
+  const next = String(req.query.next || "/");
+  const ok = next.startsWith("/") && !next.startsWith("//") && !next.includes("\\\\");
+  res.redirect(ok ? next : "/");`,
        why: 'Only local paths. Blocks `//evil.tld` and backslash tricks.',
      },
      {
        kind: 'bypassable',
        diff: `-  res.redirect(req.query.next || "/");
+  if (req.query.next?.includes("hypercart.io")) res.redirect(req.query.next);
+  else res.redirect("/");`,
        why: '`https://shop.hypercart.io@evil.tld/` contains hypercart.io too.',
      },
      {
        kind: 'breaks',
        diff: `-  res.redirect(req.query.next || "/");
+  res.redirect("https://hypercart.io");`,
        why: 'Everyone lands on the marketing site after login, every time.',
      },
    ],
  },
  {
    cls: 'ssti',
    endpoint: '/api/v2/render',
    ticket: 'email renderer builds templates from user input',
    lang: 'python',
    code: `def render(req):
    name = req.json["name"]
    tpl = "Hello " + name + ", welcome to Hypercart!"
    return jinja2.Template(tpl).render()`,
    options: [
      {
        kind: 'bypassable',
        diff: `+    name = name.replace("{{", "")`,
        why: '`{% ... %}` blocks and `{{` split across encodings still reach Jinja.',
      },
      {
        kind: 'breaks',
        diff: `-    return jinja2.Template(tpl).render()
+    return jinja2.Template("Hello {{ name }}").render()`,
        why: 'Never passes name in, so every email says "Hello ,".',
      },
      {
        kind: 'fix',
        diff: `-    tpl = "Hello " + name + ", welcome to Hypercart!"
-    return jinja2.Template(tpl).render()
+    tpl = env.from_string("Hello {{ name }}, welcome to Hypercart!")
+    return tpl.render(name=name)`,
        why: 'User input is data passed to a fixed template, never template source.',
      },
    ],
  },
  {
    cls: 'xxe',
    endpoint: '/api/v2/invoices',
    ticket: 'invoice parser resolves external entities',
    lang: 'java',
    code: `DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
Document doc = f.newDocumentBuilder().parse(req.getInputStream());`,
    options: [
      {
        kind: 'fix',
        diff: `+f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
+f.setExpandEntityReferences(false);
 Document doc = f.newDocumentBuilder().parse(req.getInputStream());`,
        why: 'No DOCTYPE, no entities. The OWASP-recommended setting.',
      },
      {
        kind: 'bypassable',
        diff: `+String xml = read(req);
+if (xml.contains("file://")) throw new BadRequest();`,
        why: '`http://`, `jar:`, `netdoc:` and parameter entities still work.',
      },
      {
        kind: 'breaks',
        diff: `+if (req.getContentType().contains("xml")) throw new BadRequest();`,
        why: 'Rejects all XML on the XML invoice endpoint. Accounting is calling.',
      },
    ],
  },
  {
    cls: 'jwt',
    endpoint: '/api/v2/me',
    ticket: 'JWT verify trusts the token header',
    lang: 'js',
    code: `const [h, p, s] = token.split(".");
const header = JSON.parse(b64(h));
const claims = jwt.verify(token, SECRET, { algorithms: [header.alg] });`,
    options: [
      {
        kind: 'bypassable',
        diff: `+if (header.alg === "none") throw new Error("nope");`,
        why: 'Case-sensitive. `None` and `nOnE` still get in.',
      },
      {
        kind: 'fix',
        diff: `-const claims = jwt.verify(token, SECRET, { algorithms: [header.alg] });
+const claims = jwt.verify(token, SECRET, { algorithms: ["HS256"] });`,
        why: 'Pin the algorithm server-side. Never let the token choose.',
      },
      {
        kind: 'breaks',
        diff: `-const claims = jwt.verify(token, SECRET, { algorithms: [header.alg] });
+const claims = jwt.verify(token, SECRET, { algorithms: ["RS256"] });`,
        why: 'Our tokens are HS256. Every real login now fails.',
      },
    ],
  },
];
