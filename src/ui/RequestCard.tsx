import { sfx } from '../audio';
import { useState } from 'preact/hooks';
import type { DifficultyConfig } from '../game/difficulty';
import { decode, decodeJwt, ENCODING_LABEL } from '../game/encoding';
import { smells } from '../game/hints';
import { ENDPOINT_NOTES } from '../game/templates';
import { t } from '../i18n';
import type { Encoding, Field, HttpRequest } from '../game/types';

interface Props {
  req: HttpRequest;
  cfg: DifficultyConfig;
  /** Spend clock time on a tool. */
  onCost?(seconds: number): void;
  compact?: boolean;
}

/** Headers that never carry payloads in this game, so Easy-mode hints skip them. */
const QUIET_HEADERS = new Set(['Host', 'Accept', 'Cookie', 'Content-Type', 'Content-Length']);

type Panel = 'decode' | 'ip' | 'notes' | 'jwt' | 'rate';

export function Sparkline({ values, onTap }: { values: number[]; onTap?(): void }) {
  const max = Math.max(4, ...values);
  const w = 72;
  const h = 22;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(' ');
  const hot = Math.max(...values) >= 10;
  return (
    <button class={`spark ${hot ? 'hot' : ''}`} onClick={onTap} aria-label={t('Request rate')}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <polyline points={pts} fill="none" stroke="currentColor" stroke-width="2" />
      </svg>
      <span>{t('{n}/s', { n: Math.max(...values) })}</span>
    </button>
  );
}

function notesFor(path: string): string | undefined {
  const key = Object.keys(ENDPOINT_NOTES)
    .filter((k) => path.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? ENDPOINT_NOTES[key] : undefined;
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 1);
  } catch {
    return s;
  }
}

export function RequestCard({ req, cfg, onCost, compact }: Props) {
  const [sel, setSel] = useState<Field | null>(null);
  const [panel, setPanel] = useState<Panel>('decode');
  const [stacks, setStacks] = useState<Record<string, string[]>>({});
  const [shake, setShake] = useState(0);

  const decoders: Encoding[] = Array.from(new Set<Encoding>(['url', 'base64', ...cfg.encodings]));
  const top = (f: Field) => stacks[f.id]?.at(-1) ?? f.raw;
  const auth = req.headers.find((h) => h.key === 'Authorization');

  const select = (f: Field, p: Panel = 'decode') => {
    if (compact) return;
    if (sel?.id === f.id && panel === p) {
      setSel(null);
      return;
    }
    setSel(f);
    setPanel(p);
    if (p === 'ip' || p === 'notes' || p === 'jwt' || p === 'rate') onCost?.(1);
  };

  const runDecoder = (enc: Encoding) => {
    if (!sel) return;
    onCost?.(1);
    const out = decode(top(sel), enc);
    if (out === null || out === top(sel)) {
      setShake((n) => n + 1);
      sfx.nope();
      navigator.vibrate?.(30);
      return;
    }
    sfx.decode();
    setStacks((s) => ({ ...s, [sel.id]: [...(s[sel.id] ?? []), out] }));
  };

  const tok = (f: Field, cls = '', p: Panel = 'decode') => {
    const layers = stacks[f.id];
    const hint = cfg.hints && !compact && f.kind !== 'method' && !QUIET_HEADERS.has(f.key ?? '') && smells(f.raw);
    return (
      <span class="tokwrap">
        <button class={`tok ${cls} ${sel?.id === f.id ? 'sel' : ''} ${hint ? 'hint' : ''}`} onClick={() => select(f, p)}>
          {(compact ? f.plain : f.raw) || t('(empty)')}
        </button>
        {layers?.length ? <span class="decoded">↳ {layers.at(-1)}</span> : null}
      </span>
    );
  };

  const notes = notesFor(req.path.plain);
  const jwt = auth ? decodeJwt(auth.raw) : null;

  return (
    <div class={`req ${compact ? 'compact' : ''}`}>
      <div class="req-from">
        <span class="muted">{t('from')}</span> {tok(req.ip, 'ip', 'ip')}
        <Sparkline values={req.rate} onTap={compact ? undefined : () => select(req.ip, 'rate')} />
      </div>
      <div class="req-line">
        <span class="method">{req.method.raw}</span> {tok(req.path, 'path', 'notes')}
        {req.query.map((q, i) => (
          <span class="q">
            <span class="punct">{i === 0 ? '?' : '&'}</span>
            <span class="qk">{q.key}=</span>
            {tok(q)}
          </span>
        ))}{' '}
        <span class="muted">HTTP/1.1</span>
      </div>
      <div class="req-headers">
        {req.headers.map((h) => (
          <div class="hdr">
            <span class="hk">{h.key}:</span> {tok(h, '', h.key === 'Authorization' && cfg.classes.includes('jwt') ? 'jwt' : 'decode')}
          </div>
        ))}
      </div>
      {req.body && <div class="req-body">{tok(req.body, 'body')}</div>}

      {sel && !compact && (
        <div class="tray" key={sel.id}>
          <div class="tray-head">
            <span class="muted">{sel.kind === 'ip' ? t('source ip') : sel.key ? `${t(sel.kind)} · ${sel.key}` : t(sel.kind)}</span>
            <button class="x" onClick={() => setSel(null)} aria-label={t('Close tools')}>
              ✕
            </button>
          </div>

          {panel === 'decode' && (
            <>
              {(stacks[sel.id] ?? []).map((l, i) => (
                <pre class="layer">
                  <span class="muted">L{i + 1}</span> {l}
                </pre>
              ))}
              <div class={`tools shake-${shake % 2}`}>
                {decoders.map((d) => (
                  <button class="tool" onClick={() => runDecoder(d)}>
                    {ENCODING_LABEL[d]}
                  </button>
                ))}
                {stacks[sel.id]?.length ? (
                  <button class="tool ghost" onClick={() => setStacks((s) => ({ ...s, [sel.id]: [] }))}>
                    {t('reset')}
                  </button>
                ) : null}
              </div>
            </>
          )}

          {panel === 'ip' && (
            <dl class="info">
              <dt>ASN</dt>
              <dd>{req.ipInfo.asn}</dd>
              <dt>{t('Country')}</dt>
              <dd>{req.ipInfo.country === 'FD' ? t('FD (Freedonia)') : req.ipInfo.country}</dd>
              <dt>{t('Reputation')}</dt>
              <dd class={`rep rep-${req.ipInfo.reputation}`}>{t(req.ipInfo.reputation)}</dd>
              <dt>{t('Seen this shift')}</dt>
              <dd>{req.ipInfo.seen}×</dd>
            </dl>
          )}

          {panel === 'rate' && (
            <dl class="info">
              <dt>{t('Peak')}</dt>
              <dd>{Math.max(...req.rate)} {t('req/s')}</dd>
              <dt>{t('Seen this shift')}</dt>
              <dd>{req.ipInfo.seen}×</dd>
              <dt>{t('Normal human')}</dt>
              <dd>0–2 {t('req/s')}</dd>
            </dl>
          )}

          {panel === 'notes' && <p class="notes">{notes ? t(notes) : t('No notes for this endpoint. Nobody documented it. Classic.')}</p>}

          {panel === 'jwt' &&
            (jwt ? (
              <div class="jwt">
                <pre class="layer">
                  <span class="muted">header</span> {prettyJson(jwt.header)}
                </pre>
                <pre class="layer">
                  <span class="muted">payload</span> {prettyJson(jwt.payload)}
                </pre>
                <pre class="layer">
                  <span class="muted">signature</span> {jwt.signature || '(empty)'}
                </pre>
              </div>
            ) : (
              <p class="notes">{t('Not a JWT.')}</p>
            ))}
        </div>
      )}
    </div>
  );
}
