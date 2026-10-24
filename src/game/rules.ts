import { t } from '../i18n';
import type { Field, HttpRequest, Rule, RuleOp, RuleTarget } from './types';

export const TARGETS: { id: RuleTarget; label: string }[] = [
  { id: 'path', label: 'Path' },
  { id: 'query', label: 'Query' },
  { id: 'body', label: 'Body' },
  { id: 'header', label: 'Headers' },
  { id: 'ua', label: 'User-Agent' },
  { id: 'ip', label: 'IP' },
  { id: 'rate', label: 'Rate' },
];

export const OPS: { id: RuleOp; label: string }[] = [
  { id: 'contains', label: 'contains' },
  { id: 'startsWith', label: 'starts with' },
  { id: 'equals', label: 'equals' },
];

/** Fields a rule looks at. Rate rules look at the traffic graph, not a field. */
function fieldsFor(target: RuleTarget, req: HttpRequest): Field[] {
  switch (target) {
    case 'path':
      return [req.path];
    case 'query':
      return req.query;
    case 'body':
      return req.body ? [req.body] : [];
    case 'header':
      return req.headers;
    case 'ua':
      return req.headers.filter((h) => h.key === 'User-Agent');
    case 'ip':
      return [req.ip];
    case 'rate':
      return [];
  }
}

/** Decoded values a rule looks at. WAFs normalise before matching, and so do we. */
export function valuesFor(target: RuleTarget, req: HttpRequest): string[] {
  if (target === 'rate') return [String(Math.max(...req.rate))];
  return fieldsFor(target, req).map((f) => f.plain);
}

function hit(rule: Pick<Rule, 'op' | 'value'>, raw: string): boolean {
  if (rule.op === 'rateAbove') return Number(raw) > Number(rule.value);
  const v = raw.toLowerCase();
  const needle = rule.value.toLowerCase();
  if (rule.op === 'contains') return v.includes(needle);
  if (rule.op === 'startsWith') return v.startsWith(needle);
  return v === needle;
}

export function matchRule(rule: Pick<Rule, 'target' | 'op' | 'value'>, req: HttpRequest): boolean {
  return valuesFor(rule.target, req).some((v) => hit(rule, v));
}

/** Ids of the fields that made a rule fire, so the card can light them up. */
export function matchedFields(rule: Pick<Rule, 'target' | 'op' | 'value'>, req: HttpRequest): string[] {
  return fieldsFor(rule.target, req)
    .filter((f) => hit(rule, f.plain))
    .map((f) => f.id);
}

export function describeRule(rule: Pick<Rule, 'target' | 'op' | 'value'>): string {
  if (rule.op === 'rateAbove') return t('rate > {n} req/s', { n: rule.value });
  const target = TARGETS.find((x) => x.id === rule.target)?.label ?? rule.target;
  const op = OPS.find((x) => x.id === rule.op)?.label ?? rule.op;
  return `${t(target)} ${t(op)} "${rule.value}"`;
}

/**
 * Tap-friendly building blocks for a rule value, taken from sample attacks.
 * Pieces shared by more samples come first, since they make better rules.
 */
export function chipsFor(target: RuleTarget, samples: HttpRequest[]): string[] {
  if (target === 'rate') return ['3', '5', '10', '20'];
  const counts = new Map<string, number>();
  for (const req of samples) {
    const seen = new Set<string>();
    for (const v of valuesFor(target, req)) {
      if (v.length <= 24) seen.add(v);
      for (const m of v.matchAll(/[A-Za-z_]{2,}|[^\sA-Za-z0-9]{1,4}|\d+/g)) {
        const t = m[0];
        if (t.length >= 2 || /[<>'"`;|$]/.test(t)) seen.add(t);
      }
    }
    for (const t of seen) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .slice(0, 20);
}
