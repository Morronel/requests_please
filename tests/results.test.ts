import { describe, expect, it } from 'vitest';
import { Run } from '../src/game/run';
import { BOARD_SIZE, store, type BoardEntry } from '../src/storage';

const entry = (score: number): BoardEntry => ({ score, shift: 2, cleared: 1, accuracy: 0.9, rank: 'Intern', ended: 'out', at: score });

describe('results board', () => {
  it('clocking out after a postmortem ends the run on the player’s terms', () => {
    const run = new Run('easy', 42);
    run.startShift();
    run.resume();
    let guard = 0;
    while (run.phase !== 'report' && run.phase !== 'over' && guard++ < 500) {
      if (run.phase === 'rule') run.deployRule(null);
      else if (run.phase === 'auto') run.ackAuto();
      else {
        run.spend(5);
        const t = run.current!.truth;
        if (t.malicious && !t.harmless) run.judge('block', t.cls);
        else run.judge('allow');
      }
    }
    expect(run.phase).toBe('report');
    run.clockOut();
    expect(run.phase).toBe('over');
    expect(run.clockedOut).toBe(true);
    expect(run.shiftsCleared).toBe(1);
  });

  it('refuses to clock out mid-shift', () => {
    const run = new Run('easy', 1);
    run.startShift();
    run.resume();
    expect(() => run.clockOut()).toThrow();
  });

  it('keeps the top runs per difficulty, best first, ties to the older run', () => {
    expect(store.recordRun('medium', entry(100))).toEqual({ best: true, place: 0 });
    expect(store.recordRun('medium', entry(300))).toEqual({ best: true, place: 0 });
    expect(store.recordRun('medium', entry(100))).toEqual({ best: false, place: 2 });
    expect(store.board('medium').map((r) => r.score)).toEqual([300, 100, 100]);
    expect(store.board('easy')).toEqual([]);
    for (let i = 0; i < BOARD_SIZE; i++) store.recordRun('medium', entry(500 + i));
    expect(store.board('medium')).toHaveLength(BOARD_SIZE);
    expect(store.recordRun('medium', entry(1)).place).toBe(-1);
    expect(store.high.medium?.score).toBe(500 + BOARD_SIZE - 1);
  });
});
