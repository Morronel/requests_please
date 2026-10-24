import { describe, expect, it } from 'vitest';
import { matchedFields, matchRule } from '../src/game/rules';
import { PATCHES } from '../src/game/patches';
import { POINTS, REVIEW_POINTS, Run } from '../src/game/run';
import { ENDPOINT } from '../src/game/templates';
import type { Difficulty } from '../src/game/types';

function perfectShift(run: Run, think = 5) {
  run.resume();
  let guard = 0;
  while (run.phase !== 'report' && run.phase !== 'over' && guard++ < 500) {
    if (run.phase === 'rule') run.deployRule(null);
    else if (run.phase === 'auto') run.ackAuto();
    else if (run.phase === 'patch') {
      const def = run.patchEvent!.def;
      run.reviewVerdict(def.vulnerable);
      if (def.vulnerable) {
        run.reviewClass(def.cls);
        run.choosePatch(def.options.findIndex((o) => o.kind === 'fix'));
      }
      run.finishPatch();
    } else {
      run.spend(think);
      const t = run.current!.truth;
      if (t.malicious && !t.harmless) run.judge('block', t.cls);
      else run.judge('allow');
    }
  }
}

describe('run', () => {
  for (const diff of ['easy', 'medium', 'hard'] as Difficulty[]) {
    it(`${diff}: a perfect player survives 8 shifts with full meters`, () => {
      const run = new Run(diff, 1234);
      for (let s = 0; s < 8; s++) {
        run.startShift();
        perfectShift(run);
        expect(run.phase).toBe('report');
      }
      expect(run.integrity).toBe(run.cfg.meter);
      expect(run.uptime).toBe(run.cfg.meter);
      expect(run.total.fp + run.total.fn).toBe(0);
      expect(run.score).toBeGreaterThan(0);
    });
  }

  it('allowing every attack ends the run', () => {
    const run = new Run('easy', 99);
    for (let s = 0; s < 10 && run.phase !== 'over'; s++) {
      run.startShift();
      run.resume();
      while (run.phase === 'request' || run.phase === 'rule') {
        if (run.phase === 'rule') run.deployRule(null);
        else {
          run.spend(5);
          run.judge('allow');
        }
      }
    }
    expect(run.phase).toBe('over');
    expect(run.integrity).toBe(0);
  });

  it('a deployed rule fires on a matching request while it is on the desk', () => {
    const run = new Run('easy', 5);
    run.startShift();
    run.rules.push({ id: 'R1', target: 'path', op: 'startsWith', value: '/', caught: 0, collateral: 0 });
    run.resume();
    expect(run.phase).toBe('auto');
    const hit = run.autoHit!;
    expect(hit.req).toBe(run.current);
    expect(hit.rule.id).toBe('R1');
    expect(hit.good).toBe(hit.req.truth.malicious);
    expect(matchedFields(hit.rule, hit.req)).toEqual([hit.req.path.id]);
    expect(run.score).toBe(hit.points);
    // A catch-all rule burns through the shift clock (or uptime) instead of looping forever.
    let guard = 0;
    while (run.phase === 'auto' && guard++ < 1000) run.ackAuto();
    expect(['report', 'over']).toContain(run.phase);
    expect(run.autoHit).toBeUndefined();
    expect(run.total.autoCaught + run.total.autoCollateral).toBe(run.index);
  });

  it('removing a rule stops it firing', () => {
    const run = new Run('easy', 5);
    run.startShift();
    run.rules.push({ id: 'R1', target: 'path', op: 'startsWith', value: '/', caught: 0, collateral: 0 });
    run.resume();
    run.removeRule('R1');
    run.ackAuto();
    expect(run.phase).toBe('request');
  });

  it('a shift lasts a fixed clock, the request on the desk at zero is the last one, and missing quota ends the run', () => {
    const run = new Run('medium', 42);
    run.startShift();
    expect(run.clock).toBe(180);
    run.resume();
    run.spend(500);
    expect(run.lastCall).toBe(true);
    expect(run.phase).toBe('request');
    run.judge('allow');
    expect(run.stats.processed).toBe(1);
    expect(run.quotaDone).toBeLessThan(run.quota);
    expect(run.phase).toBe('over');
    expect(run.overReason).toMatch(/Quota missed/);
  });

  it('faster players process more and score higher', () => {
    const shiftScore = (think: number) => {
      const run = new Run('easy', 7);
      run.startShift();
      perfectShift(run, think);
      return run.stats;
    };
    const fast = shiftScore(3);
    const slow = shiftScore(14);
    expect(fast.processed).toBeGreaterThan(slow.processed);
    expect(fast.score).toBeGreaterThan(slow.score);
    // Slower but still within quota is fine, just a lower score.
    expect(slow.score).toBeGreaterThan(0);
    expect(slow.correct).toBeGreaterThanOrEqual(8);
  });

  it('a timed-out request fails open and earns no speed bonus', () => {
    for (let s = 1; ; s++) {
      const run = new Run('easy', s);
      run.startShift();
      run.resume();
      if (!run.current!.truth.malicious) continue;
      const out = run.judge('allow', undefined, false, true);
      expect(out.kind).toBe('fn');
      expect(out.timedOut).toBe(true);
      expect(out.title).toMatch(/failed open/);
      break;
    }
  });

  it('the request timer is about 3.5x the old pace and shrinks per shift', () => {
    const run = new Run('hard', 1);
    run.startShift();
    expect(run.seconds).toBe(42);
    for (let i = 0; i < 30; i++) run.startShift();
    expect(run.seconds).toBe(18);
    expect(run.quota).toBe(18);
  });

  it('the speed bonus fades from par to twice par, and undo forfeits it', () => {
    const dealtLegit = (seed: number) => {
      for (let s = seed; ; s++) {
        const run = new Run('easy', s);
        run.startShift();
        run.resume();
        const t = run.current!.truth;
        if (!t.malicious && !t.bait) return run;
      }
    };
    const par = dealtLegit(1).cfg.parSeconds;
    const at = (took: number, noBonus = false) => {
      const run = dealtLegit(1);
      run.spend(took);
      return run.judge('allow', undefined, noBonus);
    };
    expect(at(1).points).toBe(POINTS.allow + POINTS.speed);
    expect(at(par).speedBonus).toBe(POINTS.speed);
    expect(at(par * 1.5).speedBonus).toBe(Math.round(POINTS.speed / 2));
    expect(at(par * 3).points).toBe(POINTS.allow);
    expect(at(1, true).points).toBe(POINTS.allow);
  });

  it('the patch ticket arrives at the halfway mark', () => {
    const run = new Run('medium', 11);
    run.startShift();
    expect(run.patchEvent).toBeDefined();
    run.resume();
    let guard = 0;
    while (run.phase === 'request' && guard++ < 100) {
      run.spend(10);
      const t = run.current!.truth;
      if (t.malicious && !t.harmless) run.judge('block', t.cls);
      else run.judge('allow');
    }
    expect(run.phase).toBe('patch');
    expect(run.clock).toBeLessThanOrEqual(90);
    expect(run.clock).toBeGreaterThan(80);
  });

  it('rules match decoded values', () => {
    const run = new Run('hard', 3);
    run.startShift();
    run.resume();
    const req = run.current!;
    const any = req.query[0] ?? req.headers[1];
    expect(matchRule({ target: any.kind === 'query' ? 'query' : 'header', op: 'contains', value: any.plain.slice(0, 5) }, req)).toBe(true);
  });
});

/** Plays requests perfectly until the mid-shift code review shows up. */
function toReview(run: Run) {
  run.startShift();
  run.resume();
  let guard = 0;
  while (run.phase === 'request' && guard++ < 100) {
    run.spend(10);
    const t = run.current!.truth;
    if (t.malicious && !t.harmless) run.judge('block', t.cls);
    else run.judge('allow');
  }
  expect(run.phase).toBe('patch');
  return run.patchEvent!;
}

function findSeed(want: (vulnerable: boolean) => boolean): Run {
  for (let seed = 1; seed < 200; seed++) {
    const run = new Run('hard', seed);
    run.startShift();
    if (run.patchEvent && want(run.patchEvent.def.vulnerable)) return new Run('hard', seed);
  }
  throw new Error('no seed');
}

describe('code review', () => {
  it('every snippet is well formed', () => {
    for (const p of PATCHES) {
      if (p.vulnerable) {
        expect(p.options, p.id).toHaveLength(3);
        expect(p.options.filter((o) => o.kind === 'fix'), p.id).toHaveLength(1);
        expect(p.endpoint, p.id).toBe(ENDPOINT[p.cls]);
      } else {
        expect(p.options, p.id).toHaveLength(0);
      }
    }
    expect(new Set(PATCHES.map((p) => p.id)).size).toBe(PATCHES.length);
    expect(PATCHES.some((p) => !p.vulnerable)).toBe(true);
  });

  it('spot, name and fix a vulnerable snippet', () => {
    const run = findSeed((v) => v);
    const ev = toReview(run);
    expect(ev.classChoices).toContain(ev.def.cls);
    expect(ev.classChoices).toHaveLength(4);
    const before = run.score;
    expect(run.reviewVerdict(true)).toBe(true);
    expect(ev.step).toBe('class');
    expect(run.reviewClass(ev.def.cls)).toBe(true);
    expect(ev.step).toBe('fix');
    run.choosePatch(ev.def.options.findIndex((o) => o.kind === 'fix'));
    expect(ev.step).toBe('done');
    expect(run.score - before).toBe(REVIEW_POINTS.spot + REVIEW_POINTS.cls + REVIEW_POINTS.fix);
    expect(run.patched.has(`${ev.def.cls}@${ev.def.endpoint}`)).toBe(true);
  });

  it('a wrong class still goes on to the fix', () => {
    const run = findSeed((v) => v);
    const ev = toReview(run);
    run.reviewVerdict(true);
    const wrong = ev.classChoices.find((c) => c !== ev.def.cls)!;
    expect(run.reviewClass(wrong)).toBe(false);
    expect(ev.step).toBe('fix');
  });

  it('approving vulnerable code ends the review and costs integrity later', () => {
    const run = findSeed((v) => v);
    const ev = toReview(run);
    const integrity = run.integrity;
    expect(run.reviewVerdict(false)).toBe(false);
    expect(ev.step).toBe('done');
    run.finishPatch();
    for (let i = 0; i < 6 && run.phase === 'request'; i++) {
      const t = run.current!.truth;
      if (t.malicious && !t.harmless) run.judge('block', t.cls);
      else run.judge('allow');
    }
    expect(run.integrity).toBeLessThan(integrity);
  });

  it('safe code is approved for points and blocking it earns nothing', () => {
    const a = findSeed((v) => !v);
    const evA = toReview(a);
    const before = a.score;
    expect(a.reviewVerdict(false)).toBe(true);
    expect(evA.step).toBe('done');
    expect(a.score - before).toBe(REVIEW_POINTS.safe);

    const b = findSeed((v) => !v);
    const evB = toReview(b);
    const beforeB = b.score;
    expect(b.reviewVerdict(true)).toBe(false);
    expect(evB.step).toBe('done');
    expect(b.score).toBe(beforeB);
  });
});
