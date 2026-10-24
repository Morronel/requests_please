import { useMemo, useState } from 'preact/hooks';
import { CLASSES } from '../game/codex';
import { directiveById } from '../game/directives';
import type { PatchOption } from '../game/patches';
import { chipsFor, describeRule, matchRule, OPS, TARGETS } from '../game/rules';
import { rankFor, type Run } from '../game/run';
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
          ✕ Quit
        </button>
        <h1>Shift {run.shift}</h1>
        <span class="muted">{run.cfg.title}</span>
      </header>
      <p class="memo">
        <span class="muted">From:</span> CISO · <span class="muted">Re:</span> tonight
        <br />
        {run.cfg.shiftSeconds / 60} minutes on the clock, up to {run.seconds}s per request. Quota: {run.quota} correct calls, or you're out. Fast calls score more. Integrity {run.integrity}/{run.cfg.meter}, Uptime {run.uptime}/{run.cfg.meter}.
      </p>

      <h2 class="label">Directives</h2>
      <ul class="directives">
        {ds.map((d) => (
          <li class={d.isNew ? 'new' : ''}>
            {d.isNew && <span class="badge">NEW</span>}
            <b>{d.title}.</b> {d.text}
          </li>
        ))}
        {run.retiredDirectives.map((id) => (
          <li class="retired">Retired: {directiveById(id).title}</li>
        ))}
      </ul>

      {run.rules.length > 0 && (
        <>
          <h2 class="label">Your WAF rules</h2>
          <ul class="directives">
            {run.rules.map((r) => (
              <li>
                <b>{r.id}</b> {describeRule(r)} <span class="muted">· caught {r.caught}, collateral {r.collateral}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {run.ruleEvent && <p class="intel">⚠ Threat intel: a {CLASSES[run.ruleEvent.cls].name} wave is coming. You'll get to write a rule first.</p>}
      {run.patchEvent && <p class="intel">🛠 A dev ticket for {run.patchEvent.def.endpoint} will need your review mid-shift.</p>}

      <button class="btn big primary" onClick={onStart}>
        Clock in
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
        <h1>Write a rule</h1>
        <span class="muted">
          slots {run.rules.length}/{run.cfg.ruleSlots}
        </span>
      </header>
      <p class="intel">
        Incoming {CLASSES[ev.cls].name} wave. One sample below, values already decoded; the dry run shows the rest. Build a rule that catches the attacks but not the customers.
      </p>
      <RequestCard req={ev.sample} cfg={run.cfg} compact />

      <h2 class="label">1. Match on</h2>
      <div class="chips">
        {TARGETS.map((t) => (
          <button
            class={`chip ${target === t.id ? 'on' : ''}`}
            onClick={() => {
              setTarget(t.id);
              setValue('');
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {target !== 'rate' && (
        <>
          <h2 class="label">2. Operator</h2>
          <div class="chips">
            {OPS.map((o) => (
              <button class={`chip ${op === o.id ? 'on' : ''}`} onClick={() => setOp(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}

      <h2 class="label">{target === 'rate' ? '2. Threshold (req/s above)' : '3. Value (tap a piece of the sample)'}</h2>
      <div class="chips">
        {chips.length === 0 && <span class="muted">Nothing in this part of the sample. Try another field.</span>}
        {chips.map((c) => (
          <button class={`chip mono ${value === c ? 'on' : ''}`} onClick={() => setValue(c)}>
            {c}
          </button>
        ))}
      </div>

      <div class="dryrun">
        <div class="dry-head">
          <b>{rule ? describeRule(rule) : 'No rule yet'}</b>
          <span>
            <span class="ok">caught {caught}/{attacks}</span> · <span class={collateral ? 'bad' : 'muted'}>collateral {collateral}</span>
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
      {full && rule && <p class="muted">Slots full: deploying replaces {run.rules[0].id} ({describeRule(run.rules[0])}).</p>}

      <div class="row2 sticky-actions">
        <button class="btn big" onClick={() => onDone(null)}>
          Skip
        </button>
        <button class="btn big primary" disabled={!rule} onClick={() => rule && onDone(rule)}>
          Deploy
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

const PATCH_LABEL: Record<PatchOption['kind'], string> = {
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
        <h1>Dev ticket</h1>
        <span class="muted">{CLASSES[ev.def.cls].short}</span>
      </header>
      <p class="intel">
        <b>{ev.def.endpoint}</b>: {ev.def.ticket.replace(/`/g, '')}. Three PRs are open. Approve one.
      </p>
      <pre class="code">{ev.def.code}</pre>
      <div class="patches">
        {ev.order.map((i, n) => {
          const opt = ev.def.options[i];
          const picked = chosen === opt;
          return (
            <button class={`patch-opt ${chosen ? `reveal ${opt.kind}` : ''} ${picked ? 'picked' : ''}`} disabled={!!chosen} onClick={() => onChoose(i)}>
              <span class="patch-title">
                PR #{4100 + n * 7 + run.shift} {chosen ? `· ${PATCH_LABEL[opt.kind]}` : ''}
              </span>
              <Diff text={opt.diff} />
              {chosen && <span class="why">{opt.why.replace(/`/g, '')}</span>}
            </button>
          );
        })}
      </div>
      {chosen && (
        <div class="sticky-actions">
          <button class="btn big primary" onClick={onDone}>
            {chosen.kind === 'fix' ? 'Merged. Back to the queue' : 'Back to the queue'}
          </button>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Shift report and game over
// ---------------------------------------------------------------------------

const BLAMELESS = [
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
  const line = BLAMELESS[run.shift % BLAMELESS.length];
  return (
    <main class="screen report">
      <h1>Postmortem: shift {run.shift}</h1>
      <p class="muted">Status: survived. Severity: {s.fn ? `SEV-${Math.max(1, 4 - s.fn)}` : 'none'}.</p>
      <dl class="stats">
        <dt>Quota</dt>
        <dd class="ok">
          {run.quotaDone}/{run.quota}
        </dd>
        <dt>Processed</dt>
        <dd>{s.processed}</dd>
        <dt>Accuracy</dt>
        <dd>{pct(s.correct, s.processed)}</dd>
        <dt>False positives</dt>
        <dd class={s.fp ? 'bad' : ''}>{s.fp}</dd>
        <dt>Missed attacks</dt>
        <dd class={s.fn ? 'bad' : ''}>{s.fn}</dd>
        <dt>Wrong class</dt>
        <dd>{s.wrongClass}</dd>
        <dt>Auto-blocked</dt>
        <dd>
          {s.autoCaught} <span class="muted">(+{s.autoCollateral} oops)</span>
        </dd>
        <dt>Shift score</dt>
        <dd>{s.score}</dd>
        <dt>Total score</dt>
        <dd>{run.score}</dd>
        <dt>Rank</dt>
        <dd class="ok">{rankFor(run.score)}</dd>
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
          Clock out
        </button>
        <button class="btn big primary" onClick={onNext}>
          Next shift
        </button>
      </div>
    </main>
  );
}

export function GameOver({ run, isBest, onRetry, onMenu }: { run: Run; isBest: boolean; onRetry(): void; onMenu(): void }) {
  const t = run.total;
  return (
    <main class="screen over">
      <pre class="big-stamp">TERMINATED</pre>
      <p>{run.overReason}</p>
      <dl class="stats">
        <dt>Final score</dt>
        <dd>
          {run.score} {isBest && <span class="badge">NEW BEST</span>}
        </dd>
        <dt>Rank</dt>
        <dd class="ok">{rankFor(run.score)}</dd>
        <dt>Reached shift</dt>
        <dd>{run.shift}</dd>
        <dt>Accuracy</dt>
        <dd>{pct(t.correct, t.processed)}</dd>
        <dt>Best streak</dt>
        <dd>{run.bestStreak}</dd>
        <dt>Incidents</dt>
        <dd>{t.incidents.length}</dd>
      </dl>
      <p class="muted">seed {run.seed.toString(16)}</p>
      <div class="row2 sticky-actions">
        <button class="btn big" onClick={onMenu}>
          Menu
        </button>
        <button class="btn big primary" onClick={onRetry}>
          New run
        </button>
      </div>
    </main>
  );
}
