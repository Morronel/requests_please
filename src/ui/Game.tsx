import { useEffect, useRef, useState } from 'preact/hooks';
import { sfx } from '../audio';
import { CLASSES } from '../game/codex';
import { describeRule, matchedFields } from '../game/rules';
import { explain as explainText, t } from '../i18n';
import { Run, rankFor, type Outcome, type Scenario } from '../game/run';
import type { AttackClass, Difficulty, Speaker, Verdict } from '../game/types';
import { store } from '../storage';
import { Briefing, GameOver, PatchScreen, RuleEditor, ShiftReport } from './Events';
import { RadioButton } from './Radio';
import { RequestCard } from './RequestCard';

interface Props {
  difficulty: Difficulty;
  seed: number;
  haptics: boolean;
  onExit(): void;
  onRetry(): void;
  /** Story mode: play this night instead of an endless run. */
  scenario?: Scenario;
  /** Story mode: the night is survived and the player moves on. */
  onNightDone?(run: Run): void;
}

interface Toast {
  id: number;
  tone: 'ping' | 'good' | 'bad' | 'info';
  who?: string;
  text: string;
}

export const WHO: Record<Speaker, string> = {
  chad: 'Chad (Growth)',
  ciso: 'CISO',
  intern: 'intern',
  system: 'edge-node-7',
  pentest: 'pentest',
};

const STAMP_MS = 650;
/** How long a rule hit stays on the desk before the next request; collateral lingers so it sinks in. */
const AUTO_MS = { good: 2200, bad: 3800 };
/** Longest real-time step the shift clock takes, so a backgrounded tab doesn't burn the shift. */
const MAX_TICK_S = 0.5;
const SWIPE_PX = 90;

let toastSeq = 0;

function mmss(seconds: number): string {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Pips({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <span class={`pips ${value <= 1 ? 'low' : ''}`} aria-label={t('{label} {value} of {max}', { label, value, max })}>
      <span class="pips-label">{label}</span>
      {Array.from({ length: max }, (_, i) => (
        <i class={i < value ? 'full' : ''} />
      ))}
    </span>
  );
}

export function Game({ difficulty, seed, haptics, onExit, onRetry, scenario, onNightDone }: Props) {
  const runRef = useRef<Run>();
  if (!runRef.current) {
    runRef.current = new Run(scenario ?? difficulty, seed);
    runRef.current.startShift();
  }
  const run = runRef.current;
  // #debug exposes the run for automated playtests (and for cheaters, who only cheat themselves).
  if (location.hash === '#debug') (window as unknown as { __run: Run }).__run = run;
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);

  const [classifier, setClassifier] = useState(false);
  const [stamp, setStamp] = useState<{ verdict: Verdict; cls?: AttackClass } | null>(null);
  const [feedback, setFeedback] = useState<Outcome | null>(null);
  const [explain, setExplain] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [drag, setDrag] = useState(0);
  const [best, setBest] = useState(false);
  const [held, setHeld] = useState(false);
  const stampTimer = useRef<number>();
  const autoTimer = useRef<number>();
  const paused = useRef(false);
  const requestLeft = useRef(0);
  const bonusLost = useRef(false);
  const dragStart = useRef<{ x: number; y: number; active: boolean } | null>(null);

  const buzz = (pattern: number | number[]) => {
    if (haptics) navigator.vibrate?.(pattern);
  };

  const pushToast = (t: Omit<Toast, 'id'>, ms = 3800) => {
    const id = ++toastSeq;
    setToasts((ts) => [...ts.slice(-1), { ...t, id }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), ms);
  };

  /** Pull pings and codex unlocks out of the run into toasts. */
  const flush = () => {
    for (const p of run.drainPings()) {
      sfx.ping();
      pushToast({ tone: 'ping', who: t(WHO[p.who]), text: p.text }, 5000);
    }
    const fresh = store.unlock(run.seen);
    if (fresh.length) pushToast({ tone: 'info', text: t('Codex unlocked: {names}', { names: fresh.map((c) => t(CLASSES[c].short)).join(', ') }) });
    if (run.phase === 'report') sfx.shiftEnd();
    if (run.phase === 'over') {
      sfx.gameOver();
      if (scenario) return;
      setBest(
        store.submitScore(difficulty, {
          score: run.score,
          shift: run.shift,
          accuracy: run.total.processed ? run.total.correct / run.total.processed : 0,
          rank: rankFor(run.score),
        }),
      );
    }
  };

  const startClock = () => {
    bonusLost.current = false;
    paused.current = false;
    requestLeft.current = run.seconds;
  };

  const afterAdvance = () => {
    flush();
    setClassifier(false);
    setStamp(null);
    setDrawer(false);
    if (run.phase === 'request') startClock();
    rerender();
  };

  const fraction = Math.max(0, Math.min(1, requestLeft.current / run.seconds));

  /** Leave a rule hit and deal the next request. */
  const nextAfterAuto = () => {
    if (run.phase !== 'auto') return;
    window.clearTimeout(autoTimer.current);
    setHeld(false);
    setFeedback(null);
    setExplain(false);
    run.ackAuto();
    afterAdvance();
  };
  const nextRef = useRef(nextAfterAuto);
  nextRef.current = nextAfterAuto;

  /** Stop a rule hit from moving on by itself, so the player can look at it. */
  const hold = () => {
    if (run.phase !== 'auto' || held) return;
    window.clearTimeout(autoTimer.current);
    setHeld(true);
  };

  const commit = (verdict: Verdict, cls?: AttackClass, timedOut = false) => {
    const out = run.judge(verdict, cls, bonusLost.current, timedOut);
    setFeedback(out);
    setExplain(out.kind !== 'tp' && out.kind !== 'tn');
    if (out.kind === 'fn' || out.kind === 'fp') {
      buzz([60, 60, 60]);
      sfx.wrong();
    } else {
      buzz(25);
      sfx.correct();
    }
    afterAdvance();
  };

  const stage = (verdict: Verdict, cls?: AttackClass) => {
    if (stamp || run.phase !== 'request') return;
    paused.current = true;
    setClassifier(false);
    setStamp({ verdict, cls });
    buzz(verdict === 'block' ? 40 : 15);
    if (verdict === 'block') sfx.block();
    else sfx.allow();
    stampTimer.current = window.setTimeout(() => commit(verdict, cls), STAMP_MS);
  };

  const undo = () => {
    window.clearTimeout(stampTimer.current);
    sfx.undo();
    paused.current = false;
    bonusLost.current = true;
    setStamp(null);
  };

  const cost = (seconds: number) => {
    run.spend(seconds);
    requestLeft.current -= seconds;
    rerender();
  };

  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Two clocks, both running only while a request is on the desk and not mid-stamp, so
  // briefings, rules and patches are free. The shift clock is fixed per shift; at zero, the
  // request on the desk is the last one. The request timer is per card; running out fails open.
  useEffect(() => {
    if (run.phase !== 'request') return;
    let last = performance.now();
    const h = window.setInterval(() => {
      const t = performance.now();
      const dt = Math.min(MAX_TICK_S, (t - last) / 1000);
      last = t;
      if (paused.current || run.phase !== 'request') return;
      run.spend(dt);
      requestLeft.current -= dt;
      if (requestLeft.current <= 0) commitRef.current('allow', undefined, true);
      else rerender();
    }, 100);
    return () => window.clearInterval(h);
  }, [run.phase]);

  // A rule fired on the request on the desk: sound it, stamp it, then move on by itself unless held.
  const hitId = run.phase === 'auto' ? run.current?.id : undefined;
  useEffect(() => {
    const hit = run.autoHit;
    if (!hitId || !hit) return;
    if (hit.good) {
      sfx.zap();
      sfx.block();
      buzz(25);
    } else {
      sfx.wrong();
      buzz([60, 60, 60]);
    }
    autoTimer.current = window.setTimeout(() => nextRef.current(), hit.good ? AUTO_MS.good : AUTO_MS.bad);
    return () => window.clearTimeout(autoTimer.current);
  }, [hitId]);

  useEffect(() => () => window.clearTimeout(stampTimer.current), []);

  useEffect(() => {
    if (classifier) sfx.sheet();
  }, [classifier]);

  // Keyboard: A allow, B block, 1-9/0 classes, U undo, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (run.phase === 'auto') {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight' || e.key.toLowerCase() === 'n') {
          e.preventDefault();
          nextAfterAuto();
        }
        return;
      }
      if (run.phase !== 'request') return;
      const k = e.key.toLowerCase();
      if (stamp) {
        if (k === 'u' || k === 'backspace') undo();
        return;
      }
      if (classifier) {
        const classes = [...run.cfg.classes, 'policy' as AttackClass];
        const n = k === '0' ? 10 : Number(k);
        if (n >= 1 && n <= classes.length) stage('block', classes[n - 1]);
        if (k === 'escape') setClassifier(false);
        return;
      }
      if (k === 'a') stage('allow');
      if (k === 'b') setClassifier(true);
      if (k === 'escape') setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onPointerDown = (e: PointerEvent) => {
    if (run.phase === 'auto') return hold();
    if (stamp || classifier) return;
    dragStart.current = { x: e.clientX, y: e.clientY, active: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const s = dragStart.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.active && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.4) s.active = true;
    if (s.active) setDrag(dx);
  };
  const onPointerUp = () => {
    const s = dragStart.current;
    dragStart.current = null;
    if (!s?.active) return;
    if (drag > SWIPE_PX) stage('allow');
    else if (drag < -SWIPE_PX) setClassifier(true);
    setDrag(0);
  };

  // ------------------------------------------------------------------------
  switch (run.phase) {
    case 'briefing':
      return (
        <Briefing
          run={run}
          onQuit={onExit}
          onStart={() => {
            sfx.shiftStart();
            run.resume();
            afterAdvance();
          }}
        />
      );
    case 'rule':
      return (
        <RuleEditor
          run={run}
          onDone={(rule) => {
            run.deployRule(rule);
            if (rule) sfx.deploy();
            if (rule) pushToast({ tone: 'info', text: t('Deployed: {rule}', { rule: describeRule(rule) }) });
            afterAdvance();
          }}
        />
      );
    case 'patch':
      return (
        <PatchScreen
          run={run}
          onChoose={(i) => {
            run.choosePatch(i);
            rerender();
          }}
          onDone={() => {
            run.finishPatch();
            afterAdvance();
          }}
        />
      );
    case 'report':
      return (
        <ShiftReport
          run={run}
          onQuit={onExit}
          onNext={() => {
            if (onNightDone) return onNightDone(run);
            run.startShift();
            rerender();
          }}
        />
      );
    case 'over':
      return <GameOver run={run} isBest={best} onRetry={onRetry} onMenu={onExit} />;
  }

  const req = run.current!;
  const auto = run.phase === 'auto' ? run.autoHit! : null;
  const autoName = auto?.req.truth.cls ? t(CLASSES[auto.req.truth.cls].short) : t('request');
  const classes = [...run.cfg.classes, 'policy' as AttackClass];
  const swipeHint = drag > 30 ? 'allow' : drag < -30 ? 'block' : '';

  return (
    <main class="game">
      <header class="hud">
        <div class="hud-row">
          <Pips label={t('INT')} value={run.integrity} max={run.cfg.meter} />
          <Pips label={t('UP')} value={run.uptime} max={run.cfg.meter} />
          <RadioButton />
          <button class="hud-dir" onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>
            § {run.directives.length}
            {run.rules.length ? ` · R${run.rules.length}` : ''}
          </button>
        </div>
        <div class="hud-row small">
          <span class={run.lastCall ? 'clock last' : 'clock'}>
            {run.night ? t('N{night}', { night: run.night }) : t('S{shift}', { shift: run.shift })} · {run.lastCall ? t('LAST CALL') : mmss(run.clock)}
          </span>
          <span class={run.quotaDone >= run.quota ? 'quota met' : 'quota'} aria-label={t('Quota {done} of {quota}', { done: run.quotaDone, quota: run.quota })}>
            ✓{Math.min(run.quotaDone, run.quota)}/{run.quota}
          </span>
          <span class="score">{run.score}</span>
          <span class={run.multiplier > 1 ? 'streak hot' : 'streak'}>
            {run.streak}🔥{run.multiplier > 1 ? ` ×${run.multiplier}` : ''}
          </span>
        </div>
        {auto ? (
          <div class={`timer auto ${auto.good ? '' : 'low'} ${held ? 'held' : ''}`}>
            <i key={req.id} style={{ animationDuration: `${auto.good ? AUTO_MS.good : AUTO_MS.bad}ms` }} />
          </div>
        ) : (
          <div class={`timer ${fraction < 0.25 ? 'low' : ''}`}>
            <i style={{ width: `${fraction * 100}%` }} />
          </div>
        )}
        <button
          class={`status ${auto ? (auto.good ? 'fb-tp open' : 'fb-fp open') : feedback ? `fb-${feedback.kind}` : ''} ${explain && !auto ? 'open' : ''}`}
          onClick={() => setExplain(!explain)}
          disabled={!feedback || !!auto}
        >
          {auto ? (
            <>
              <span class="status-line">
                <span class="prompt">&gt;</span>{' '}
                {auto.good ? t('{rule} auto-blocked {name}', { rule: auto.rule.id, name: autoName }) : t('Collateral: {rule} blocked a real customer', { rule: auto.rule.id })}
                <b>{auto.points > 0 ? `+${auto.points}` : auto.points}</b>
              </span>
              <span class="status-why">
                {auto.good
                  ? t('Your rule caught it, so it counts toward the quota.')
                  : t('Legit traffic matched your rule. Remove it, or live with the angry customers.')}
              </span>
            </>
          ) : feedback ? (
            <>
              <span class="status-line">
                <span class="prompt">&gt;</span> {feedback.title}
                <b>
                  {feedback.speedBonus > 0 && '⚡'}
                  {feedback.points > 0 ? `+${feedback.points}` : feedback.points}
                </b>
              </span>
              {explain && <span class="status-why">{explainText(feedback.truth.explain)}</span>}
            </>
          ) : (
            <span class="status-line muted">
              <span class="prompt">&gt;</span> {t('waiting for verdict… (tap values to inspect)')}
            </span>
          )}
        </button>
      </header>

      {drawer && (
        <div class="drawer" onClick={() => setDrawer(false)}>
          <h2 class="label">{t('Directives')}</h2>
          <ul class="directives">
            {run.directiveTexts().map((d) => (
              <li class={d.isNew ? 'new' : ''}>
                <b>{t(d.title)}.</b> {t(d.text)}
              </li>
            ))}
          </ul>
          {run.rules.length > 0 && (
            <>
              <h2 class="label">{t('WAF rules')}</h2>
              <ul class="directives">
                {run.rules.map((r) => (
                  <li>
                    <b>{r.id}</b> {describeRule(r)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p class="muted">{t('tap to close')}</p>
        </div>
      )}

      <div class="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div class={`toast t-${t.tone}`}>
            {t.who && <b>{t.who}: </b>}
            {t.text}
          </div>
        ))}
      </div>

      <section
        class={`card-area swipe-${swipeHint}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragStart.current = null;
          setDrag(0);
        }}
      >
        <div class={`card ${auto ? (auto.good ? 'auto-good' : 'auto-bad') : ''}`} key={req.id} style={drag ? { transform: `translateX(${drag}px) rotate(${drag / 40}deg)` } : undefined}>
          {auto && (
            <div class="rule-fired">
              <b>⚡ {t('{rule} fired', { rule: auto.rule.id })}</b> <span>{describeRule(auto.rule)}</span>
              <span class="muted">{held ? t('held. tap Next when ready') : t('tap the card to hold')}</span>
            </div>
          )}
          <RequestCard
            req={req}
            cfg={run.cfg}
            onCost={auto ? undefined : cost}
            hits={auto ? matchedFields(auto.rule, req) : undefined}
            rateHit={auto?.rule.target === 'rate'}
          />
          {auto && (
            <div class={`stamp stamp-block ${auto.good ? '' : 'stamp-collateral'}`}>
              403 {auto.rule.id}
              {!auto.good && <small>{t('collateral')}</small>}
            </div>
          )}
          {stamp && <div class={`stamp stamp-${stamp.verdict}`}>{stamp.verdict === 'allow' ? '200 OK' : `403 ${stamp.cls ? t(CLASSES[stamp.cls].short) : ''}`}</div>}
        </div>
      </section>

      {classifier && (
        <div class="sheet-backdrop" onClick={() => setClassifier(false)}>
          <div class="sheet" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-head">
              <b>{t('Block as…')}</b>
              <button class="x" onClick={() => setClassifier(false)} aria-label={t('Cancel')}>
                ✕
              </button>
            </div>
            <div class={`classes cols-${classes.length > 6 ? 3 : 2}`}>
              {classes.map((c, i) => (
                <button class={`cls cls-${c}`} onClick={() => stage('block', c)}>
                  <span class="cls-icon">{CLASSES[c].icon}</span>
                  <span class="cls-name">{t(CLASSES[c].short)}</span>
                  <span class="cls-key">{i < 9 ? i + 1 : i === 9 ? 0 : ''}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer class="verdicts">
        {auto ? (
          <>
            {!auto.good && run.rules.includes(auto.rule) && (
              <button
                class="btn verdict block"
                onClick={() => {
                  run.removeRule(auto.rule.id);
                  sfx.undo();
                  nextAfterAuto();
                }}
              >
                {t('Remove {rule}', { rule: auto.rule.id })}
              </button>
            )}
            <button class="btn verdict next" onClick={nextAfterAuto}>
              {t('Next')} ▸
            </button>
          </>
        ) : stamp ? (
          <button class="btn verdict undo" onClick={undo}>
            ↶ {t('Undo')}
          </button>
        ) : (
          <>
            <button class="btn verdict allow" onClick={() => stage('allow')}>
              {t('ALLOW')}
            </button>
            <button class="btn verdict block" onClick={() => setClassifier(true)}>
              {t('BLOCK')}
            </button>
          </>
        )}
      </footer>
    </main>
  );
}
