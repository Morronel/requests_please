import { useEffect, useRef, useState } from 'preact/hooks';
import { sfx } from '../audio';
import { CLASSES } from '../game/codex';
import { describeRule } from '../game/rules';
import { Run, rankFor, type Outcome } from '../game/run';
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
}

interface Toast {
  id: number;
  tone: 'ping' | 'good' | 'bad' | 'info';
  who?: string;
  text: string;
}

const WHO: Record<Speaker, string> = {
  chad: 'Chad (Growth)',
  ciso: 'CISO',
  intern: 'intern',
  system: 'edge-node-7',
  pentest: 'pentest',
};

const STAMP_MS = 650;
const SWIPE_PX = 90;

let toastSeq = 0;

function Pips({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <span class={`pips ${value <= 1 ? 'low' : ''}`} aria-label={`${label} ${value} of ${max}`}>
      <span class="pips-label">{label}</span>
      {Array.from({ length: max }, (_, i) => (
        <i class={i < value ? 'full' : ''} />
      ))}
    </span>
  );
}

export function Game({ difficulty, seed, haptics, onExit, onRetry }: Props) {
  const runRef = useRef<Run>();
  if (!runRef.current) {
    runRef.current = new Run(difficulty, seed);
    runRef.current.startShift();
  }
  const run = runRef.current;
  // #debug exposes the run for automated playtests (and for cheaters, who only cheat themselves).
  if (location.hash === '#debug') (window as unknown as { __run: Run }).__run = run;
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);

  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(() => performance.now());
  const [classifier, setClassifier] = useState(false);
  const [stamp, setStamp] = useState<{ verdict: Verdict; cls?: AttackClass } | null>(null);
  const [feedback, setFeedback] = useState<Outcome | null>(null);
  const [explain, setExplain] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [drag, setDrag] = useState(0);
  const [best, setBest] = useState(false);
  const stampTimer = useRef<number>();
  const pausedLeft = useRef<number | null>(null);
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

  /** Pull pings, auto-blocks and codex unlocks out of the run into toasts. */
  const flush = () => {
    for (const a of run.drainAutoBlocks()) {
      if (a.good) sfx.zap();
      else sfx.wrong();
      const name = a.req.truth.cls ? CLASSES[a.req.truth.cls].short : 'request';
      pushToast(
        a.good
          ? { tone: 'good', text: `${a.rule.id} auto-blocked ${name} (+${a.points})` }
          : { tone: 'bad', text: `${a.rule.id} blocked a real customer: ${a.req.method.plain} ${a.req.path.plain} (${a.points})` },
      );
    }
    for (const p of run.drainPings()) {
      sfx.ping();
      pushToast({ tone: 'ping', who: WHO[p.who], text: p.text }, 5000);
    }
    const fresh = store.unlock(run.seen);
    if (fresh.length) pushToast({ tone: 'info', text: `Codex unlocked: ${fresh.map((c) => CLASSES[c].short).join(', ')}` });
    if (run.phase === 'report') sfx.shiftEnd();
    if (run.phase === 'over') {
      sfx.gameOver();
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
    const t = performance.now();
    setNow(t);
    setDeadline(t + run.seconds * 1000);
    bonusLost.current = false;
    pausedLeft.current = null;
  };

  const afterAdvance = () => {
    flush();
    setClassifier(false);
    setStamp(null);
    setDrawer(false);
    if (run.phase === 'request') startClock();
    rerender();
  };

  const timeLeftMs = () => (pausedLeft.current ?? deadline - now);
  const fraction = Math.max(0, Math.min(1, timeLeftMs() / (run.seconds * 1000)));

  const commit = (verdict: Verdict, cls?: AttackClass, timedOut = false) => {
    const frac = bonusLost.current || timedOut ? 0 : Math.max(0, (pausedLeft.current ?? deadline - performance.now()) / (run.seconds * 1000));
    const out = run.judge(verdict, cls, frac, timedOut);
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
    pausedLeft.current = Math.max(0, deadline - performance.now());
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
    const left = pausedLeft.current ?? 0;
    pausedLeft.current = null;
    bonusLost.current = true;
    const t = performance.now();
    setNow(t);
    setDeadline(t + left);
    setStamp(null);
  };

  const cost = (seconds: number) => setDeadline((d) => d - seconds * 1000);

  // Request timer. Running out means the WAF fails open.
  useEffect(() => {
    if (run.phase !== 'request') return;
    const h = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(h);
  }, [run.phase, deadline]);

  useEffect(() => {
    if (run.phase === 'request' && !stamp && pausedLeft.current === null && deadline && now >= deadline) commit('allow', undefined, true);
  });

  useEffect(() => () => window.clearTimeout(stampTimer.current), []);

  useEffect(() => {
    if (classifier) sfx.sheet();
  }, [classifier]);

  // Keyboard: A allow, B block, 1-9/0 classes, U undo, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
            if (rule) pushToast({ tone: 'info', text: `Deployed: ${describeRule(rule)}` });
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
            run.startShift();
            rerender();
          }}
        />
      );
    case 'over':
      return <GameOver run={run} isBest={best} onRetry={onRetry} onMenu={onExit} />;
  }

  const req = run.current!;
  const classes = [...run.cfg.classes, 'policy' as AttackClass];
  const swipeHint = drag > 30 ? 'allow' : drag < -30 ? 'block' : '';

  return (
    <main class="game">
      <header class="hud">
        <div class="hud-row">
          <Pips label="INT" value={run.integrity} max={run.cfg.meter} />
          <Pips label="UP" value={run.uptime} max={run.cfg.meter} />
          <RadioButton />
          <button class="hud-dir" onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>
            § {run.directives.length}
            {run.rules.length ? ` · R${run.rules.length}` : ''}
          </button>
        </div>
        <div class="hud-row small">
          <span>
            S{run.shift} · {run.index + 1}/{run.length}
          </span>
          <span class="score">{run.score}</span>
          <span class={run.multiplier > 1 ? 'streak hot' : 'streak'}>
            {run.streak}🔥{run.multiplier > 1 ? ` ×${run.multiplier}` : ''}
          </span>
        </div>
        <div class={`timer ${fraction < 0.3 ? 'low' : ''}`}>
          <i style={{ width: `${fraction * 100}%` }} />
        </div>
        <button class={`status ${feedback ? `fb-${feedback.kind}` : ''} ${explain ? 'open' : ''}`} onClick={() => setExplain(!explain)} disabled={!feedback}>
          {feedback ? (
            <>
              <span class="status-line">
                <span class="prompt">&gt;</span> {feedback.title}
                <b>{feedback.points > 0 ? `+${feedback.points}` : feedback.points}</b>
              </span>
              {explain && <span class="status-why">{feedback.truth.explain}</span>}
            </>
          ) : (
            <span class="status-line muted">
              <span class="prompt">&gt;</span> waiting for verdict… (tap values to inspect)
            </span>
          )}
        </button>
      </header>

      {drawer && (
        <div class="drawer" onClick={() => setDrawer(false)}>
          <h2 class="label">Directives</h2>
          <ul class="directives">
            {run.directiveTexts().map((d) => (
              <li class={d.isNew ? 'new' : ''}>
                <b>{d.title}.</b> {d.text}
              </li>
            ))}
          </ul>
          {run.rules.length > 0 && (
            <>
              <h2 class="label">WAF rules</h2>
              <ul class="directives">
                {run.rules.map((r) => (
                  <li>
                    <b>{r.id}</b> {describeRule(r)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p class="muted">tap to close</p>
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
        <div class="card" key={req.id} style={drag ? { transform: `translateX(${drag}px) rotate(${drag / 40}deg)` } : undefined}>
          <RequestCard req={req} cfg={run.cfg} onCost={cost} />
          {stamp && <div class={`stamp stamp-${stamp.verdict}`}>{stamp.verdict === 'allow' ? '200 OK' : `403 ${stamp.cls ? CLASSES[stamp.cls].short : ''}`}</div>}
        </div>
      </section>

      {classifier && (
        <div class="sheet-backdrop" onClick={() => setClassifier(false)}>
          <div class="sheet" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-head">
              <b>Block as…</b>
              <button class="x" onClick={() => setClassifier(false)} aria-label="Cancel">
                ✕
              </button>
            </div>
            <div class={`classes cols-${classes.length > 6 ? 3 : 2}`}>
              {classes.map((c, i) => (
                <button class={`cls cls-${c}`} onClick={() => stage('block', c)}>
                  <span class="cls-icon">{CLASSES[c].icon}</span>
                  <span class="cls-name">{CLASSES[c].short}</span>
                  <span class="cls-key">{i < 9 ? i + 1 : i === 9 ? 0 : ''}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer class="verdicts">
        {stamp ? (
          <button class="btn verdict undo" onClick={undo}>
            ↶ Undo
          </button>
        ) : (
          <>
            <button class="btn verdict allow" onClick={() => stage('allow')}>
              ALLOW
            </button>
            <button class="btn verdict block" onClick={() => setClassifier(true)}>
              BLOCK
            </button>
          </>
        )}
      </footer>
    </main>
  );
}
