import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLASSES } from '../src/game/codex';
import { DIFFICULTIES } from '../src/game/difficulty';
import { DIRECTIVES } from '../src/game/directives';
import { PATCHES } from '../src/game/patches';
import { Rng } from '../src/game/rng';
import { OPS, TARGETS } from '../src/game/rules';
import { CHAD_LINES, FLAVOR, INCIDENT_LINES, RANKS, Run } from '../src/game/run';
import { ATTACKS, BAIT, ENDPOINT_NOTES, LEGIT } from '../src/game/templates';
import { explain, setLang, t } from '../src/i18n';
import { UK } from '../src/i18n/uk';
import { BLAMELESS, PATCH_LABEL } from '../src/ui/Events';
import { WHO } from '../src/ui/Game';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

/** First-argument string literals of t(...) / tr(...) calls. */
function literalKeys(): string[] {
  const keys: string[] = [];
  const re = /\b(?:t|tr)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  for (const file of sources('src')) {
    for (const m of readFileSync(file, 'utf8').matchAll(re)) keys.push(m[2].replace(/\\(['"\\])/g, '$1'));
  }
  return keys;
}

/** Every explanation a template or directive can produce. */
function explanations(): string[] {
  const cfg = DIFFICULTIES.hard;
  const out = new Set<string>(['Regular customer traffic.', 'The endpoint is patched, so it bounces off harmlessly.']);
  const makers = [...Object.values(ATTACKS).flat(), ...Object.values(BAIT).flat(), ...LEGIT];
  for (let seed = 1; seed <= 3; seed++) {
    const rng = new Rng(seed);
    for (const make of makers) out.add(make(rng, cfg).truth!.explain);
    for (const d of DIRECTIVES) {
      out.add(d.violate(rng).truth!.explain);
      if (d.lookalike) out.add(d.lookalike(rng).truth!.explain);
    }
  }
  return [...out];
}

/** Keys passed to t() through a variable rather than as a literal. */
const DYNAMIC = [
  'EASY', 'MEDIUM', 'HARD', 'green', 'amber', 'ice', 'on', 'off',
  'clean', 'unknown', 'suspicious', 'malicious', 'tor',
  'method', 'path', 'query', 'header', 'body', 'ip',
];

function allKeys(): string[] {
  return [
    ...literalKeys(),
    ...DYNAMIC,
    ...Object.values(CLASSES).flatMap((c) => [c.short, c.name, c.tell, c.why, c.fix]),
    ...DIRECTIVES.flatMap((d) => [d.title, d.text]),
    ...Object.values(DIFFICULTIES).flatMap((d) => [d.title, d.tagline]),
    ...PATCHES.flatMap((p) => [p.title, p.explain, ...p.options.map((o) => o.why)]),
    ...Object.values(ENDPOINT_NOTES),
    ...RANKS.map(([, r]) => r),
    ...Object.values(INCIDENT_LINES),
    ...CHAD_LINES,
    ...FLAVOR.map(([, l]) => l),
    ...Object.values(WHO),
    ...Object.values(PATCH_LABEL),
    ...BLAMELESS,
    ...TARGETS.map((x) => x.label),
    ...OPS.map((x) => x.label),
    ...explanations(),
  ];
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  afterEach(() => setLang('en'));

  it('every English string has a Ukrainian translation', () => {
    const missing = [...new Set(allKeys())].filter((k) => !UK[k] && k !== 'root' && k !== '200 OK');
    expect(missing).toEqual([]);
  });

  it('translations keep the same placeholders', () => {
    for (const [en, uk] of Object.entries(UK)) expect(placeholders(uk), en).toEqual(placeholders(en));
  });

  it('English is the identity and params are filled', () => {
    expect(t('Shift {n}', { n: 3 })).toBe('Shift 3');
    setLang('uk');
    expect(t('Shift {n}', { n: 3 })).toBe('Зміна 3');
    expect(t('no such string')).toBe('no such string');
  });

  it('patched explanations translate both halves', () => {
    setLang('uk');
    const s = explain('Path traversal to read /etc/passwd. The endpoint is patched, so it bounces off harmlessly.');
    expect(s).toBe(`${UK['Path traversal to read /etc/passwd.']} ${UK['The endpoint is patched, so it bounces off harmlessly.']}`);
  });

  it('a run in Ukrainian produces Ukrainian feedback', () => {
    setLang('uk');
    const run = new Run('easy', 7);
    run.startShift();
    run.resume();
    const out = run.judge('block', 'policy');
    expect(out.title).toMatch(/Заблоковано|Хибне спрацювання/);
  });
});
