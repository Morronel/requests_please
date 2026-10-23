import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../src/game/difficulty';
import { DIRECTIVES, directiveById } from '../src/game/directives';
import { encodeLayers } from '../src/game/encoding';
import { generateRequest } from '../src/game/generator';
import { Rng } from '../src/game/rng';
import { ATTACKS, BAIT } from '../src/game/templates';
import type { AttackClass, HttpRequest } from '../src/game/types';

const allDirectives = DIRECTIVES.map((d) => d.id);

function fields(r: HttpRequest) {
  return [r.method, r.path, r.ip, ...r.query, ...r.headers, ...(r.body ? [r.body] : [])];
}

describe('generator', () => {
  for (const cfg of Object.values(DIFFICULTIES)) {
    it(`${cfg.id}: requests are consistent with their truth`, () => {
      const rng = new Rng(42);
      for (let i = 0; i < 2000; i++) {
        const directives = rng.shuffle(allDirectives).slice(0, rng.int(0, cfg.maxDirectives));
        const req = generateRequest({ rng, cfg, directives, patched: new Set() });
        const violated = directives.filter((id) => directiveById(id).violates(req));
        if (req.truth.cls === 'policy') expect(violated.length, req.truth.explain).toBe(1);
        else expect(violated, `${req.truth.explain} ${req.path.plain}`).toEqual([]);
        if (req.truth.cls && req.truth.cls !== 'policy') expect(cfg.classes).toContain(req.truth.cls);
        for (const f of fields(req)) expect(encodeLayers(f.plain, f.layers)).toBe(f.raw);
        if (!req.truth.malicious) expect(req.truth.cls).toBeUndefined();
      }
    });
  }

  it('every attack class has templates, and bait exists for the basics', () => {
    for (const cls of Object.keys(ATTACKS) as AttackClass[]) expect(ATTACKS[cls as keyof typeof ATTACKS].length).toBeGreaterThan(0);
    for (const cls of ['sqli', 'xss', 'traversal', 'scanner'] as AttackClass[]) expect(BAIT[cls]?.length).toBeGreaterThan(0);
  });

  it('marks attacks on patched endpoints harmless', () => {
    const rng = new Rng(7);
    const cfg = DIFFICULTIES.hard;
    let harmless = 0;
    for (let i = 0; i < 200; i++) {
      const r = generateRequest({ rng, cfg, directives: [], patched: new Set(['sqli@/products']) }, { kind: 'attack', cls: 'sqli' });
      if (r.path.plain === '/products') {
        expect(r.truth.harmless).toBe(true);
        harmless++;
      } else expect(r.truth.harmless).toBeFalsy();
    }
    expect(harmless).toBeGreaterThan(0);
  });
});
