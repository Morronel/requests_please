import type { DifficultyConfig } from './difficulty';
import { DIRECTIVES, directiveById } from './directives';
import { build, type Draft } from './draft';
import type { Rng } from './rng';
import { ATTACKS, BAIT, LEGIT } from './templates';
import type { AttackClass, HttpRequest } from './types';

export interface GenContext {
  rng: Rng;
  cfg: DifficultyConfig;
  /** Active directive ids. */
  directives: string[];
  /** `${cls}@${endpoint}` keys of patched endpoints. */
  patched: Set<string>;
}

export type Kind = 'attack' | 'policy' | 'bait' | 'legit';

export interface GenOptions {
  kind?: Kind;
  cls?: Exclude<AttackClass, 'policy'>;
}

function rollKind(ctx: GenContext): Kind {
  const { rng, cfg, directives } = ctx;
  if (rng.chance(cfg.attackShare)) {
    const policyShare = directives.length ? Math.min(0.35, 0.12 + 0.04 * directives.length) : 0;
    return rng.chance(policyShare) ? 'policy' : 'attack';
  }
  return rng.chance(cfg.baitShare) ? 'bait' : 'legit';
}

function draftFor(ctx: GenContext, kind: Kind, cls?: Exclude<AttackClass, 'policy'>): { d: Draft; violated?: string } {
  const { rng, cfg, directives } = ctx;
  switch (kind) {
    case 'policy': {
      const id = rng.pick(directives);
      return { d: directiveById(id).violate(rng), violated: id };
    }
    case 'attack': {
      const pool = cfg.classes.filter((c): c is Exclude<AttackClass, 'policy'> => c !== 'policy');
      const c = cls ?? rng.pick(pool);
      return { d: rng.pick(ATTACKS[c])(rng, cfg) };
    }
    case 'bait': {
      const lookalikes = directives.map(directiveById).filter((x) => x.lookalike);
      if (lookalikes.length && rng.chance(0.3)) return { d: rng.pick(lookalikes).lookalike!(rng) };
      const pool = cfg.classes.filter((c) => BAIT[c]?.length);
      const c = cls && BAIT[cls] ? cls : rng.pick(pool);
      return { d: rng.pick(BAIT[c]!)(rng, cfg) };
    }
    case 'legit':
      return { d: rng.pick(LEGIT)(rng, cfg) };
  }
}

export function generateRequest(ctx: GenContext, opts: GenOptions = {}): HttpRequest {
  const kind = opts.kind ?? rollKind(ctx);
  const { d, violated } = draftFor(ctx, kind === 'policy' && !ctx.directives.length ? 'attack' : kind, opts.cls);
  for (const id of ctx.directives) {
    if (id !== violated) directiveById(id).comply?.(d, ctx.rng);
  }
  const t = d.truth;
  if (t.malicious && t.cls && t.endpoint && ctx.patched.has(`${t.cls}@${t.endpoint}`)) {
    t.harmless = true;
    t.explain += ' The endpoint is patched, so it bounces off harmlessly.';
  }
  return build(d, ctx.rng, ctx.cfg);
}

/** Directives in a random order for this run. */
export function directiveOrder(rng: Rng): string[] {
  return rng.shuffle(DIRECTIVES.map((d) => d.id));
}
