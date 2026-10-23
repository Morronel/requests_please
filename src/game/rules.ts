import type { HttpRequest, Rule, RuleOp, RuleTarget } from './types';

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

/** Decoded values a rule looks at. WAFs normalise before matching, and so do we. */
export function valuesFor(target: RuleTarget, req: HttpRequest): string[] {
  switch (target) {
    case 'path':
      return [req.path.plain];
    case 'query':
      return req.query.map((q) => q.plain);
    case 'body':
      return req.body ? [req.body.plain] : [];
    case 'header':
      return req.headers.map((h) => h.plain);
    case 'ua':
      return req.headers.filter((h) => h.key === 'User-Agent').map((h) => h.plain);
    case 'ip':
      return [req.ip.plain];
    case 'rate':
      return [String(Math.max(...req.rate))];
  }
}

export function matchRule(rule: Pick<Rule, 'target' | 'op' | 'value'>, req: HttpRequest): boolean {
  const values = valuesFor(rule.target, req);
  if (rule.op === 'rateAbove') return values.some((v) => Number(v) > Number(rule.value));
  const needle = rule.value.toLowerCase();
  return values.some((raw) => {
    const v = raw.toLowerCase();
    if (rule.op === 'contains') return v.includes(needle);
    if (rule.op === 'startsWith') return v.startsWith(needle);
    return v === needle;
  });
}

export function describeRule(rule: Pick<Rule, 'target' | 'op' | 'value'>): string {
  if (rule.op === 'rateAbove') return `rate > ${rule.value} req/s`;
  const t = TARGETS.find((x) => x.id === rule.target)?.label ?? rule.target;
  const o = OPS.find((x) => x.id === rule.op)?.label ?? rule.op;
  return `${t} ${o} "${rule.value}"`;
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
