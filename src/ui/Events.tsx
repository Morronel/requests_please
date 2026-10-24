import { useMemo, useState } from 'preact/hooks';
import { NIGHTS } from '../game/campaign';
import { CLASSES } from '../game/codex';
import { directiveById } from '../game/directives';
import type { PatchOption } from '../game/patches';
import { chipsFor, describeRule, matchRule, OPS, TARGETS } from '../game/rules';
import { rankFor, type Run } from '../game/run';
import { t } from '../i18n';
import type { Rule, RuleOp, RuleTarget } from '../game/types';
import { RequestCard } from './RequestCard';

// ---------------------------------------------------------------------------
// Briefing
// ---------------------------------------------------------------------------

export function Briefing({ run, onStart, onQuit }: { run: Run; onStart(): void; onQuit(): void }) {
  const ds = run.directiveTexts();
  return (
    <main class="screen briefing">
      <header class="bar">
        <button class="btn small" onClick={onQuit}>
          ✕ {t('Quit')}
        </button>
        <h1>{run.night ? t('Night {n} of {total}', { n: run.night, total: NIGHTS }) : t('Shift {n}', { n: run.shift })}</h1>
        <span class="muted">{t(run.cfg.title)}</span>
      </header>
      <p class="memo">
        <span class="muted">{t('From:')}</span> {t('CISO')} · <span class="muted">{t('Re:')}</span> {t('tonight')}
        <br />
        {t("{min} minutes on the clock, up to {s}s per request. Quota: {quota} correct calls, or you're out. Fast calls score more. Integrity {i}/{max}, Uptime {u}/{max}.", { min: run.cfg.shiftSeconds / 60, s: run.seconds, quota: run.quota, i: run.integrity, u: run.uptime, max: run.cfg.meter })}
      </p>

      {(ds.length > 0 || run.retiredDirectives.length > 0) && <h2 class="label">{t('Directives')}</h2>}
      <ul class="directives">
        {ds.map((d) => (
          <li class={d.isNew ? 'new' : ''}>
            {d.isNew && <span class="badge">{t('NEW')}</span>}
            <b>{t(d.title)}.</b> {t(d.text)}
          </li>
        ))}
        {run.retiredDirectives.map((id) => (
          <li class="retired">{t('Retired: {title}', { title: t(directiveById(id).title) })}</li>
        ))}
      </ul>

      {run.rules.length > 0 && (
        <>
          <h2 class="label">{t('Your WAF rules')}</h2>
          <ul class="directives">
            {run.rules.map((r) => (
              <li>
                <b>{r.id}</b> {describeRule(r)} <span class="muted">· {t('caught {caught}, collateral {collateral}', { caught: r.caught, collateral: r.collateral })}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {run.ruleEvent && <p class="intel">⚠ {t("Threat intel: a {name} wave is coming. You'll get to write a rule first.", { name: t(CLASSES[run.ruleEvent.cls].name) })}</p>}
      {run.patchEvent && <p class="intel">🛠 {t('A dev ticket for {endpoint} will need your review mid-shift.', { endpoint: run.patchEvent.def.endpoint })}</p>}

      <button class="btn big primary" onClick={onStart}>
        {t('Clock in')}
      </button>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Rule editor
// ---------------------------------------------------------------------------

export function RuleEditor({ run, onDone }: { run: Run; onDone(rule: Omit<Rule, 'id' | 'caught' | 'collateral'> | null): void }) {
  const ev = run.ruleEvent!;
  const [target, setTarget] = useState<RuleTarget>(() => (ev.sample.query.length ? 'query' : ev.sample.body ? 'body' : 'header'));
  const [op, setOp] = useState<RuleOp>('contains');
  const [value, setValue] = useState('');
  const chips = useMemo(() => chipsFor(target, [ev.sample, ...ev.testSet.filter((r) => r.truth.malicious)]), [target, ev]);
  const effectiveOp: RuleOp = target === 'rate' ? 'rateAbove' : op;
  const rule = value ? { target, op: effectiveOp, value } : null;
  const results = ev.testSet.map((r) => ({ r, hit: rule ? matchRule(rule, r) : false, bad: r.truth.malicious }));
  const caught = results.filter((x) => x.hit && x.bad).length;
  const collateral = results.filter((x) => x.hit && !x.bad).length;
  const attacks = results.filter((x) => x.bad).length;
  const full = run.rules.length >= run.cfg.ruleSlots;

  return (
    <main class="screen rule">
      <header class="bar">
        <h1>{t('Write a rule')}</h1>
        <span class="muted">
          {t('slots')} {run.rules.length}/{run.cfg.ruleSlots}
        </span>
      </header>
      <p class="intel">
        {t('Incoming {name} wave. One sample below, values already decoded; the dry run shows the rest. Build a rule that catches the attacks but not the customers.', { name: t(CLASSES[ev.cls].name) })}
      </p>
      <RequestCard req={ev.sample} cfg={run.cfg} compact />

      <h2 class="label">{t('1. Match on')}</h2>
      <div class="chips">
        {TARGETS.map((tg) => (
          <button
            class={`chip ${target === tg.id ? 'on' : ''}`}
            onClick={() => {
              setTarget(tg.id);
              setValue('');
            }}
          >
            {t(tg.label)}
          </button>
        ))}
      </div>

      {target !== 'rate' && (
        <>
          <h2 class="label">{t('2. Operator')}</h2>
          <div class="chips">
            {OPS.map((o) => (
              <button class={`chip ${op === o.id ? 'on' : ''}`} onClick={() => setOp(o.id)}>
                {t(o.label)}
              </button>
            ))}
          </div>
        </>
      )}

      <h2 class="label">{target === 'rate' ? t('2. Threshold (req/s above)') : t('3. Value (tap a piece of the sample)')}</h2>
      <div class="chips">
        {chips.length === 0 && <span class="muted">{t('Nothing in this part of the sample. Try another field.')}</span>}
        {chips.map((c) => (
          <button class={`chip mono ${value === c ? 'on' : ''}`} onClick={() => setValue(c)}>
            {c}
          </button>
        ))}
      </div>

      <div class="dryrun">
        <div class="dry-head">
          <b>{rule ? describeRule(rule) : t('No rule yet')}</b>
          <span>
            <span class="ok">{t('caught {n}/{total}', { n: caught, total: attacks })}</span> · <span class={collateral ? 'bad' : 'muted'}>{t('collateral {n}', { n: collateral })}</span>
          </span>
        </div>
        <ul>
          {results.map(({ r, hit, bad }) => (
            <li class={hit ? (bad ? 'hit-good' : 'hit-bad') : bad ? 'miss' : 'pass'}>
              <span class="mark">{hit ? (bad ? '✓' : '✗') : bad ? '·' : ' '}</span>
              <span class="mono">
                {r.method.plain} {r.path.plain}
                {r.query[0] ? `?${r.query[0].key}=${r.query[0].plain}` : r.body ? `  ${r.body.plain.slice(0, 60)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {full && rule && <p class="muted">{t('Slots full: deploying replaces {id} ({rule}).', { id: run.rules[0].id, rule: describeRule(run.rules[0]) })}</p>}

      <div class="row2 sticky-actions">
        <button class="btn big" onClick={() => onDone(null)}>
          {t('Skip')}
        </button>
        <button class="btn big primary" disabled={!rule} onClick={() => rule && onDone(rule)}>
          {t('Deploy')}
        </button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Patch review
// ---------------------------------------------------------------------------

function Diff({ text }: { text: string }) {
  return (
    <pre class="diff">
      {text.split('\n').map((l) => (
        <div class={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>{l}</div>
      ))}
    </pre>
  );
}

export const PATCH_LABEL: Record<PatchOption['kind'], string> = {
  fix: '✓ Real fix',
  bypassable: '⚠ Bypassable',
  breaks: '✗ Breaks the feature',
};

export function PatchScreen({ run, onChoose, onDone }: { run: Run; onChoose(i: number): void; onDone(): void }) {
  const ev = run.patchEvent!;
  const chosen = ev.chosen;
  return (
    <main class="screen patch">
      <header class="bar">
        <h1>{t('Dev ticket')}</h1>
        <span class="muted">{t(CLASSES[ev.def.cls].short)}</span>
      </header>
      <p class="intel">
        <b>{ev.def.endpoint}</b>: {t(ev.def.ticket).replace(/`/g, '')}. {t('Three PRs are open. Approve one.')}
      </p>
      <pre class="code">{ev.def.code}</pre>
      <div class="patches">
        {ev.order.map((i, n) => {
          const opt = ev.def.options[i];
          const picked = chosen === opt;
          return (
            <button class={`patch-opt ${chosen ? `reveal ${opt.kind}` : ''} ${picked ? 'picked' : ''}`} disabled={!!chosen} onClick={() => onChoose(i)}>
              <span class="patch-title">
                PR #{4100 + n * 7 + run.shift} {chosen ? `· ${t(PATCH_LABEL[opt.kind])}` : ''}
              </span>
              <Diff text={opt.diff} />
              {chosen && <span class="why">{t(opt.why).replace(/`/g, '')}</span>}
            </button>
          );
        })}
      </div>
      {chosen && (
        <div class="sticky-actions">
          <button class="btn big primary" onClick={onDone}>
            {chosen.kind === 'fix' ? t('Merged. Back to the queue') : t('Back to the queue')}
          </button>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Shift report and game over
// ---------------------------------------------------------------------------

export const BLAMELESS = [
  'Root cause: the intern. This is a blameless postmortem.',
  'Contributing factor: Mercury in retrograde. And the intern.',
  'Action item: add another dashboard nobody reads.',
  'Lessons learned: it is always DNS. Except tonight.',
  'Follow-up: schedule a meeting to plan the meeting.',
];

function pct(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : '–';
}

export function ShiftReport({ run, onNext, onQuit }: { run: Run; onNext(): void; onQuit(): void }) {
  const s = run.stats;
  const line = t(BLAMELESS[run.shift % BLAMELESS.length]);
  return (
    <main class="screen report">
      <h1>{run.night ? t('Postmortem: night {n}', { n: run.night }) : t('Postmortem: shift {n}', { n: run.shift })}</h1>
      <p class="muted">{t('Status: survived. Severity: {sev}.', { sev: s.fn ? `SEV-${Math.max(1, 4 - s.fn)}` : t('none') })}</p>
      <dl class="stats">
        <dt>{t('Quota')}</dt>
        <dd class="ok">
          {run.quotaDone}/{run.quota}
        </dd>
        <dt>{t('Processed')}</dt>
        <dd>{s.processed}</dd>
        <dt>{t('Accuracy')}</dt>
        <dd>{pct(s.correct, s.processed)}</dd>
        <dt>{t('False positives')}</dt>
        <dd class={s.fp ? 'bad' : ''}>{s.fp}</dd>
        <dt>{t('Missed attacks')}</dt>
        <dd class={s.fn ? 'bad' : ''}>{s.fn}</dd>
        <dt>{t('Wrong class')}</dt>
        <dd>{s.wrongClass}</dd>
        <dt>{t('Auto-blocked')}</dt>
        <dd>
          {s.autoCaught} <span class="muted">{t('(+{n} oops)', { n: s.autoCollateral })}</span>
        </dd>
        <dt>{t('Shift score')}</dt>
        <dd>{s.score}</dd>
        <dt>{t('Total score')}</dt>
        <dd>{run.score}</dd>
        <dt>{t('Rank')}</dt>
        <dd class="ok">{t(rankFor(run.score))}</dd>
      </dl>
      {s.incidents.length > 0 && (
        <ul class="incidents">
          {s.incidents.map((i) => (
            <li>{i}</li>
          ))}
        </ul>
      )}
      <p class="muted">{line}</p>
      <div class="row2 sticky-actions">
        <button class="btn big" onClick={onQuit}>
          {t('Clock out')}
        </button>
        <button class="btn big primary" onClick={onNext}>
          {!run.night ? t('Next shift') : run.night < NIGHTS ? t('Next night') : t('See the morning')}
        </button>
      </div>
    </main>
  );
}

export function GameOver({ run, isBest, onRetry, onMenu }: { run: Run; isBest: boolean; onRetry(): void; onMenu(): void }) {
  const tot = run.total;
  return (
    <main class="screen over">
      <pre class="big-stamp">TERMINATED</pre>
      <p>{run.overReason}</p>
      <dl class="stats">
        <dt>{t('Final score')}</dt>
        <dd>
          {run.score} {isBest && <span class="badge">{t('NEW BEST')}</span>}
        </dd>
        <dt>{t('Rank')}</dt>
        <dd class="ok">{t(rankFor(run.score))}</dd>
        <dt>{run.night ? t('Reached night') : t('Reached shift')}</dt>
        <dd>{run.night ?? run.shift}</dd>
        <dt>{t('Accuracy')}</dt>
        <dd>{pct(tot.correct, tot.processed)}</dd>
        <dt>{t('Best streak')}</dt>
        <dd>{run.bestStreak}</dd>
        <dt>{t('Incidents')}</dt>
        <dd>{tot.incidents.length}</dd>
      </dl>
      <p class="muted">{t('seed')} {run.seed.toString(16)}</p>
      <div class="row2 sticky-actions">
        <button class="btn big" onClick={onMenu}>
          {t('Menu')}
        </button>
        <button class="btn big primary" onClick={onRetry}>
          {run.night ? t('Retry the night') : t('New run')}
        </button>
      </div>
    </main>
  );
}
