import { describe, expect, it } from 'vitest';
import { matchRule } from '../src/game/rules';
import { Run } from '../src/game/run';
import type { Difficulty } from '../src/game/types';

function perfectShift(run: Run) {
  run.resume();
  let guard = 0;
  while (run.phase !== 'report' && run.phase !== 'over' && guard++ < 200) {
    if (run.phase === 'rule') run.deployRule(null);
    else if (run.phase === 'patch') {
      const i = run.patchEvent!.def.options.findIndex((o) => o.kind === 'fix');
      run.choosePatch(i);
      run.finishPatch();
    } else {
      const t = run.current!.truth;
      if (t.malicious && !t.harmless) run.judge('block', t.cls, 1);
      else run.judge('allow', undefined, 1);
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
        else run.judge('allow');
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
    expect(run.phase).toBe('report');
    expect(run.total.autoCaught + run.total.autoCollateral).toBe(run.length);
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
