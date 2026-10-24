import { describe, expect, it } from 'vitest';
import { matchRule } from '../src/game/rules';
import { POINTS, Run } from '../src/game/run';
import type { Difficulty } from '../src/game/types';

function perfectShift(run: Run, think = 5) {
  run.resume();
  let guard = 0;
  while (run.phase !== 'report' && run.phase !== 'over' && guard++ < 500) {
    if (run.phase === 'rule') run.deployRule(null);
    else if (run.phase === 'patch') {
      const i = run.patchEvent!.def.options.findIndex((o) => o.kind === 'fix');
      run.choosePatch(i);
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

  it('a deployed rule auto-blocks matching requests', () => {
    const run = new Run('easy', 5);
    run.startShift();
    run.rules.push({ id: 'R1', target: 'path', op: 'startsWith', value: '/', caught: 0, collateral: 0 });
    run.resume();
    // A catch-all rule burns through the shift clock (or uptime) instead of looping forever.
    expect(['report', 'over']).toContain(run.phase);
    expect(run.total.autoCaught + run.total.autoCollateral).toBe(run.index);
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
