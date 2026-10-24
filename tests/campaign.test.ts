import { describe, expect, it } from 'vitest';
import { endingFor, linesFor, nightConfig, nightDef, nightScenario, NIGHTS, STORY } from '../src/game/campaign';
import { DIFFICULTIES } from '../src/game/difficulty';
import { directiveById } from '../src/game/directives';
import { Run } from '../src/game/run';

/** Plays the current shift perfectly, deploying no rules and reviewing code correctly. */
function perfectNight(run: Run, think = 5) {
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

describe('campaign', () => {
  it('has 15 nights with known directives', () => {
    expect(STORY).toHaveLength(NIGHTS);
    STORY.forEach((d, i) => expect(d.n).toBe(i + 1));
    for (const d of STORY) d.directives.forEach((id) => expect(() => directiveById(id)).not.toThrow());
  });

  it('starts like endless Easy and ends at least as hard as endless Hard', () => {
    const first = nightConfig(1);
    const last = nightConfig(NIGHTS);
    const { easy, hard } = DIFFICULTIES;
    expect(first.secondsStart).toBe(easy.secondsStart);
    expect(first.quota).toBe(easy.quota);
    expect(first.meter).toBe(easy.meter);
    expect(first.hints).toBe(true);
    expect(last.secondsStart).toBeLessThanOrEqual(hard.secondsStart);
    expect(last.quota).toBeGreaterThanOrEqual(hard.quota);
    expect(last.maxLayers).toBe(hard.maxLayers);
    expect(new Set(last.classes)).toEqual(new Set(hard.classes));
    expect(last.meter).toBe(hard.meter);
  });

  it('ramps steadily from night to night', () => {
    for (let n = 2; n <= NIGHTS; n++) {
      const a = nightConfig(n - 1);
      const b = nightConfig(n);
      expect(b.secondsStart, `night ${n}`).toBeLessThanOrEqual(a.secondsStart);
      expect(b.quota, `night ${n}`).toBeGreaterThanOrEqual(a.quota);
      expect(b.classes.length, `night ${n}`).toBeGreaterThanOrEqual(a.classes.length);
      expect(b.meter, `night ${n}`).toBeLessThanOrEqual(a.meter);
    }
  });

  it('choices change the nights after them', () => {
    expect(nightConfig(6, { friday: 'growth' }).quota).toBe(nightConfig(6).quota - 1);
    expect(nightConfig(6, { friday: 'lockdown' }).quota).toBe(nightConfig(6).quota + 1);
    expect(nightConfig(9, { intern: 'report' }).meter).toBe(nightConfig(9).meter + 1);
    expect(nightConfig(13, { crew: 'decline' }).ruleSlots).toBe(nightConfig(13).ruleSlots + 1);
    expect(nightConfig(13, { crew: 'double' }).baitShare).toBeLessThan(nightConfig(13).baitShare);
    const six = nightDef(6);
    expect(linesFor(six, { friday: 'growth' }).map((l) => l.who)).toContain('chad');
    expect(linesFor(six, { friday: 'lockdown' }).map((l) => l.who)).not.toContain('chad');
  });

  it('three endings, picked by the choices', () => {
    expect(endingFor({ friday: 'growth', intern: 'cover', crew: 'double' }).title).toBe('Double agent');
    expect(endingFor({ friday: 'growth', crew: 'decline' }).title).toBe('Employee of the Month');
    expect(endingFor({ friday: 'lockdown', crew: 'decline' }).title).toBe('Head of Edge Security');
    expect(endingFor({ intern: 'cover' }).epilogue).toMatch(/junior/);
  });

  it('a night is one shift with its own directives, wave and carried score', () => {
    const run = new Run(nightScenario(3, {}, 1200), 9);
    run.startShift();
    expect(run.night).toBe(3);
    expect(run.score).toBe(1200);
    expect(run.directives).toEqual(['admin-internal', 'no-trace']);
    expect(run.newDirectives).toEqual(['no-trace']);
    expect(run.ruleEvent?.cls).toBe('sqli');
    expect(run.integrity).toBe(run.cfg.meter);
  });

  it('a perfect player clears all 15 nights, with meters refilled each night', () => {
    const choices = { friday: 'lockdown', intern: 'report', crew: 'decline' };
    let score = 0;
    for (let n = 1; n <= NIGHTS; n++) {
      const run = new Run(nightScenario(n, choices, score), 100 + n);
      run.startShift();
      expect(run.integrity).toBe(run.cfg.meter);
      perfectNight(run, n < 8 ? 5 : 4);
      expect(run.phase, `night ${n}: ${run.overReason}`).toBe('report');
      expect(run.score).toBeGreaterThan(score);
      score = run.score;
    }
  });
});
