import { CLASSES } from './codex';
import { DIFFICULTIES, secondsFor, shiftLength, type DifficultyConfig } from './difficulty';
import { directiveById } from './directives';
import { directiveOrder, generateRequest, type GenContext, type GenOptions } from './generator';
import { PATCHES, type PatchDef, type PatchOption } from './patches';
import { Rng } from './rng';
import { matchRule } from './rules';
import type { AttackClass, ChatPing, Difficulty, HttpRequest, Rule, Speaker, Truth, Verdict } from './types';

export type Phase = 'briefing' | 'request' | 'rule' | 'patch' | 'report' | 'over';

export type OutcomeKind = 'tp' | 'tn' | 'fp' | 'fn' | 'wrongclass';

export interface Outcome {
  kind: OutcomeKind;
  verdict: Verdict;
  picked?: AttackClass;
  points: number;
  title: string;
  truth: Truth;
  timedOut: boolean;
}

export interface AutoBlock {
  rule: Rule;
  req: HttpRequest;
  good: boolean;
  points: number;
}

export interface ShiftStats {
  processed: number;
  correct: number;
  fp: number;
  fn: number;
  wrongClass: number;
  autoCaught: number;
  autoCollateral: number;
  score: number;
  incidents: string[];
}

export interface RuleEvent {
  cls: Exclude<AttackClass, 'policy'>;
  sample: HttpRequest;
  testSet: HttpRequest[];
}

export interface PatchEvent {
  def: PatchDef;
  /** Option order as shown, so the right answer isn't always first. */
  order: number[];
  chosen?: PatchOption;
}

interface Pending {
  fireIn: number;
  meter: 'integrity' | 'uptime';
  who: Speaker;
  text: string;
}

const emptyStats = (): ShiftStats => ({
  processed: 0,
  correct: 0,
  fp: 0,
  fn: 0,
  wrongClass: 0,
  autoCaught: 0,
  autoCollateral: 0,
  score: 0,
  incidents: [],
});

export const RANKS: [number, string][] = [
  [0, 'Script Kiddie'],
  [400, 'Packet Pusher'],
  [1200, 'Log Goblin'],
  [2500, 'SOC Analyst'],
  [4500, 'Threat Hunter'],
  [7500, '0day Whisperer'],
  [12000, 'root'],
];

export function rankFor(score: number): string {
  let name = RANKS[0][1];
  for (const [min, r] of RANKS) if (score >= min) name = r;
  return name;
}

const INCIDENT_LINES: Partial<Record<AttackClass, string>> = {
  sqli: 'user table is now on Pastebin',
  xss: 'customers are getting cookie-stealing popups',
  traversal: '/etc/passwd is trending on Twitter',
  scanner: 'a scanner mapped every endpoint we own',
  cmdi: 'someone has a shell on the ops box',
  ssrf: 'AWS keys pulled from the metadata service',
  stuffing: '412 customer accounts taken over',
  redirect: 'phishing campaign using our login page',
  ssti: 'RCE on the email renderer',
  log4shell: 'a miner is eating 100% CPU on the log cluster',
  xxe: 'invoice service leaked server files',
  jwt: 'random user is now admin',
  smuggling: 'admin panel reached through a smuggled request',
  policy: 'legal is asking why we ignored the directive',
};

const CHAD_LINES = [
  'why is checkout down?? a customer just tweeted at us',
  'that was a paying customer. PAYING.',
  'my conversion dashboard just went red. was that you?',
  'can we not block people who want to give us money',
];

const FLAVOR: [Speaker, string][] = [
  ['intern', 'quick q: is it fine if i deploy from prod? asking for a friend'],
  ['intern', 'i rotated the API keys! (by adding a 1 at the end)'],
  ['chad', 'reminder: Q4 OKR is 0 blocked customers 🙏'],
  ['ciso', 'auditors arrive tomorrow. no incidents today please.'],
  ['intern', 'who owns the server under the coffee machine'],
  ['chad', 'can the WAF block competitors from seeing our prices?'],
  ['ciso', 'whoever named the admin password "hypercart2024": we need to talk'],
  ['intern', 'git push --force worked great btw'],
  ['system', 'coffee level: low. alertness: -5%'],
];

export class Run {
  readonly cfg: DifficultyConfig;
  readonly rng: Rng;
  readonly seed: number;

  shift = 0;
  score = 0;
  streak = 0;
  bestStreak = 0;
  integrity: number;
  uptime: number;

  directives: string[] = [];
  newDirectives: string[] = [];
  retiredDirectives: string[] = [];
  private directivePool: string[];

  rules: Rule[] = [];
  patched = new Set<string>();

  phase: Phase = 'briefing';
  current: HttpRequest | null = null;
  index = 0;
  length = 0;
  private plan: GenOptions[] = [];
  private events = new Map<number, 'rule' | 'patch'>();
  ruleEvent?: RuleEvent;
  patchEvent?: PatchEvent;

  private pending: Pending[] = [];
  private collateralHits = 0;
  pings: ChatPing[] = [];
  autoBlocks: AutoBlock[] = [];
  private pingSeq = 0;

  total = emptyStats();
  stats = emptyStats();
  seen = new Set<AttackClass>();
  overReason = '';

  constructor(difficulty: Difficulty, seed: number) {
    this.cfg = DIFFICULTIES[difficulty];
    this.seed = seed;
    this.rng = new Rng(seed);
    this.integrity = this.cfg.meter;
    this.uptime = this.cfg.meter;
    this.directivePool = directiveOrder(this.rng);
  }

  get seconds(): number {
    return secondsFor(this.cfg, this.shift);
  }

  get multiplier(): number {
    const s = this.streak;
    return s >= 20 ? 3 : s >= 10 ? 2 : s >= 5 ? 1.5 : 1;
  }

  private ctx(): GenContext {
    return { rng: this.rng, cfg: this.cfg, directives: this.directives, patched: this.patched };
  }

  ping(who: Speaker, text: string): void {
    this.pings.push({ id: ++this.pingSeq, who, text });
  }

  /** Set up the next shift and show its briefing. */
  startShift(): void {
    this.shift++;
    this.stats = emptyStats();
    this.newDirectives = [];
    this.retiredDirectives = [];
    const next = this.directivePool.shift();
    if (next) {
      if (this.directives.length >= this.cfg.maxDirectives) {
        const old = this.directives.shift()!;
        this.retiredDirectives.push(old);
        this.directivePool.push(old);
      }
      this.directives.push(next);
      this.newDirectives.push(next);
    }

    this.length = shiftLength(this.cfg, this.shift);
    this.plan = Array.from({ length: this.length }, () => ({}));
    this.index = 0;
    this.events.clear();

    if (this.shift >= 2 && this.shift % 2 === 0) {
      this.events.set(0, 'rule');
      const pool = this.cfg.classes.filter((c): c is Exclude<AttackClass, 'policy'> => c !== 'policy');
      const cls = this.rng.pick(pool);
      this.ruleEvent = { cls, sample: generateRequest(this.ctx(), { kind: 'attack', cls }), testSet: this.testSet(cls) };
      // The wave: extra attacks of the same class spread through the shift.
      for (let i = 0; i < 4; i++) this.plan[this.rng.int(1, this.length - 1)] = { kind: 'attack', cls };
    }

    if (this.cfg.patches) {
      const open = PATCHES.filter((p) => this.cfg.classes.includes(p.cls) && !this.patched.has(`${p.cls}@${p.endpoint}`));
      if (open.length) {
        const def = this.rng.pick(open);
        const at = Math.floor(this.length / 2);
        this.events.set(at, 'patch');
        this.patchEvent = { def, order: this.rng.shuffle([0, 1, 2]) };
        // Make sure the patched endpoint gets tested soon after.
        for (let i = 1; i <= 2 && at + i * 2 < this.length; i++) this.plan[at + i * 2] = { kind: 'attack', cls: def.cls as Exclude<AttackClass, 'policy'> };
      }
    }
    this.phase = 'briefing';
  }

  private testSet(cls: Exclude<AttackClass, 'policy'>): HttpRequest[] {
    const ctx = this.ctx();
    const set: HttpRequest[] = [];
    for (let i = 0; i < 5; i++) set.push(generateRequest(ctx, { kind: 'attack', cls }));
    for (let i = 0; i < 2; i++) set.push(generateRequest(ctx, { kind: 'bait', cls }));
    for (let i = 0; i < 3; i++) set.push(generateRequest(ctx, { kind: 'legit' }));
    return this.rng.shuffle(set);
  }

  /** Leave the briefing (or an event) and move to whatever comes next. */
  resume(): void {
    this.advance();
  }

  private advance(): void {
    while (this.phase !== 'over') {
      if (this.index >= this.length) return this.endShift();
      const ev = this.events.get(this.index);
      if (ev) {
        this.events.delete(this.index);
        this.phase = ev;
        this.current = null;
        return;
      }
      const req = generateRequest(this.ctx(), this.plan[this.index]);
      const rule = this.rules.find((r) => matchRule(r, req));
      if (rule) {
        this.autoBlock(rule, req);
        this.index++;
        this.tick();
        continue;
      }
      if (this.rng.chance(0.08)) {
        const [who, text] = this.rng.pick(FLAVOR);
        this.ping(who, text);
      }
      this.current = req;
      this.phase = 'request';
      return;
    }
  }

  private autoBlock(rule: Rule, req: HttpRequest): void {
    const good = req.truth.malicious;
    const points = good ? 5 : -10;
    if (good) {
      rule.caught++;
      this.stats.autoCaught++;
      this.total.autoCaught++;
    } else {
      rule.collateral++;
      this.stats.autoCollateral++;
      this.total.autoCollateral++;
      if (++this.collateralHits % 3 === 0) {
        this.pending.push({ fireIn: 0, meter: 'uptime', who: 'chad', text: `your rule "${rule.value}" is blocking real customers. three of them. so far.` });
      }
    }
    if (req.truth.cls) this.seen.add(req.truth.cls);
    this.addScore(points);
    this.autoBlocks.push({ rule, req, good, points });
  }

  private addScore(points: number): void {
    this.score += points;
    this.stats.score += points;
  }

  /** Player verdict on the current request. `timeLeft` is 0..1 of the request timer. */
  judge(verdict: Verdict, picked?: AttackClass, timeLeft = 0, timedOut = false): Outcome {
    const req = this.current;
    if (!req || this.phase !== 'request') throw new Error('no request to judge');
    const t = req.truth;
    const timeBonus = Math.round(10 * Math.max(0, Math.min(1, timeLeft)));
    const cls = t.cls ? CLASSES[t.cls].short : '';
    let kind: OutcomeKind;
    let points: number;
    let title: string;

    if (verdict === 'allow') {
      if (!t.malicious || t.harmless) {
        kind = 'tn';
        points = 10 + (t.bait ? 5 : 0) + timeBonus;
        title = t.harmless ? `200 OK: ${cls} bounced off the patch` : t.bait ? '200 OK: nice, not fooled' : '200 OK';
      } else {
        kind = 'fn';
        points = -30;
        title = timedOut ? `Timed out: WAF failed open, ${cls} got through` : `Missed: ${cls} got through`;
        const inc = `INC-${this.rng.int(1000, 9999)}: ${INCIDENT_LINES[t.cls!] ?? 'something bad happened'}`;
        this.stats.incidents.push(inc);
        this.total.incidents.push(inc);
        this.pending.push({ fireIn: 2, meter: 'integrity', who: 'ciso', text: `${inc}. explain.` });
      }
    } else if (t.malicious) {
      if (picked === t.cls) {
        kind = 'tp';
        points = 25 + timeBonus;
        title = `403 Blocked: ${cls}, correct`;
      } else {
        kind = 'wrongclass';
        points = this.cfg.wrongClassPoints;
        title = `Blocked, but it was ${cls}`;
      }
    } else {
      kind = 'fp';
      points = -15;
      title = t.bait ? 'False positive: it only looked scary' : 'False positive: legit customer';
      this.pending.push({ fireIn: 1, meter: 'uptime', who: 'chad', text: this.rng.pick(CHAD_LINES) });
    }

    if (points > 0) points = Math.round(points * this.multiplier);
    if (kind === 'tp' || kind === 'tn') {
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else if (kind !== 'wrongclass') this.streak = 0;

    for (const s of [this.stats, this.total]) {
      s.processed++;
      if (kind === 'tp' || kind === 'tn') s.correct++;
      if (kind === 'fp') s.fp++;
      if (kind === 'fn') s.fn++;
      if (kind === 'wrongclass') s.wrongClass++;
    }
    if (t.cls) this.seen.add(t.cls);
    this.addScore(points);

    this.index++;
    this.current = null;
    this.tick();
    this.advance();
    return { kind, verdict, picked, points, title, truth: t, timedOut };
  }

  /** Count down delayed consequences and fire the due ones. */
  private tick(): void {
    for (const p of this.pending) p.fireIn--;
    const due = this.pending.filter((p) => p.fireIn < 0);
    this.pending = this.pending.filter((p) => p.fireIn >= 0);
    due.forEach((p) => this.fire(p));
  }

  private fire(p: Pending): void {
    this.ping(p.who, p.text);
    if (p.meter === 'integrity') this.integrity = Math.max(0, this.integrity - 1);
    else this.uptime = Math.max(0, this.uptime - 1);
    if (this.integrity <= 0) this.gameOver('Integrity hit zero. The breach made the news, and you made the postmortem.');
    else if (this.uptime <= 0) this.gameOver('Uptime hit zero. Growth convinced the board to bring back the ML firewall.');
  }

  private gameOver(reason: string): void {
    if (this.phase === 'over') return;
    this.overReason = reason;
    this.phase = 'over';
    this.current = null;
  }

  private endShift(): void {
    const due = this.pending;
    this.pending = [];
    due.forEach((p) => this.fire(p));
    if (this.phase !== 'over') this.phase = 'report';
    this.current = null;
  }

  deployRule(rule: Omit<Rule, 'id' | 'caught' | 'collateral'> | null): void {
    if (rule) {
      if (this.rules.length >= this.cfg.ruleSlots) this.rules.shift();
      this.rules.push({ ...rule, id: `R${this.shift}`, caught: 0, collateral: 0 });
    }
    this.ruleEvent = undefined;
    this.advance();
  }

  removeRule(id: string): void {
    this.rules = this.rules.filter((r) => r.id !== id);
  }

  choosePatch(optionIndex: number): PatchOption {
    const ev = this.patchEvent;
    if (!ev) throw new Error('no patch event');
    const opt = ev.def.options[optionIndex];
    ev.chosen = opt;
    const name = CLASSES[ev.def.cls].short;
    if (opt.kind === 'fix') {
      this.patched.add(`${ev.def.cls}@${ev.def.endpoint}`);
      this.addScore(50);
      this.ping('system', `patch deployed to ${ev.def.endpoint}. ${name} there is now harmless.`);
    } else if (opt.kind === 'bypassable') {
      this.ping('intern', 'patch shipped!! 🚀 closing the ticket');
      this.pending.push({ fireIn: 3, meter: 'integrity', who: 'ciso', text: `the ${ev.def.endpoint} patch was bypassed within the hour. a blacklist? really?` });
    } else {
      this.pending.push({ fireIn: 0, meter: 'uptime', who: 'chad', text: `${ev.def.endpoint} is broken for every customer since your patch` });
    }
    return opt;
  }

  finishPatch(): void {
    this.patchEvent = undefined;
    this.tick();
    if (this.phase !== 'over') this.advance();
  }

  drainPings(): ChatPing[] {
    const p = this.pings;
    this.pings = [];
    return p;
  }

  drainAutoBlocks(): AutoBlock[] {
    const a = this.autoBlocks;
    this.autoBlocks = [];
    return a;
  }

  directiveTexts(): { id: string; title: string; text: string; isNew: boolean }[] {
    return this.directives.map((id) => {
      const d = directiveById(id);
      return { id, title: d.title, text: d.text, isNew: this.newDirectives.includes(id) };
    });
  }
}
