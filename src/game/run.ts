import { t as tr } from '../i18n';
import { CLASSES } from './codex';
import { DIFFICULTIES, quotaFor, secondsFor, type DifficultyConfig } from './difficulty';
import { directiveById } from './directives';
import { directiveOrder, generateRequest, type GenContext, type GenOptions } from './generator';
import { PATCHES, type PatchDef, type PatchOption } from './patches';
import { Rng } from './rng';
import { matchRule } from './rules';
import type { AttackClass, ChatPing, Difficulty, HttpRequest, Rule, Speaker, Truth, Verdict } from './types';

/** `auto` means a deployed rule fired on the request on the desk; the player watches, then moves on. */
export type Phase = 'briefing' | 'request' | 'auto' | 'rule' | 'patch' | 'report' | 'over';

export type OutcomeKind = 'tp' | 'tn' | 'fp' | 'fn' | 'wrongclass';

export interface Outcome {
  kind: OutcomeKind;
  verdict: Verdict;
  picked?: AttackClass;
  points: number;
  title: string;
  truth: Truth;
  /** Speed bonus included in `points`, before the streak multiplier. */
  speedBonus: number;
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

/** verdict: vulnerable or not? class: which bug? fix: which PR? done: the outcome is on screen. */
export type ReviewStep = 'verdict' | 'class' | 'fix' | 'done';

export interface PatchEvent {
  def: PatchDef;
  /** Option order as shown, so the right answer isn't always first. */
  order: number[];
  /** Classes offered on the "which bug" step, the right one among them. */
  classChoices: AttackClass[];
  step: ReviewStep;
  saidVulnerable?: boolean;
  pickedClass?: AttackClass;
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
  [600, 'Packet Pusher'],
  [1800, 'Log Goblin'],
  [3800, 'SOC Analyst'],
  [7000, 'Threat Hunter'],
  [11500, '0day Whisperer'],
  [18000, 'root'],
];

/** Points for a correct call, before the speed bonus and streak multiplier. */
export const POINTS = { allow: 15, bait: 5, block: 30, speed: 15 };

/** Code review: spotting the bug, naming it, shipping the fix, or rightly approving safe code. */
export const REVIEW_POINTS = { spot: 15, cls: 15, fix: 50, safe: 50 };

/** Classes a code review can be about. Scanners, stuffing and the like are not bugs in a snippet. */
const REVIEWABLE = new Set(PATCHES.map((p) => p.cls));

/** Shift-clock seconds an auto-blocked request takes, so a catch-all rule can't spin forever. */
const AUTO_BLOCK_SECONDS = 1;

export function rankFor(score: number): string {
  let name = RANKS[0][1];
  for (const [min, r] of RANKS) if (score >= min) name = r;
  return name;
}

export const INCIDENT_LINES: Partial<Record<AttackClass, string>> = {
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

export const CHAD_LINES = [
  'why is checkout down?? a customer just tweeted at us',
  'that was a paying customer. PAYING.',
  'my conversion dashboard just went red. was that you?',
  'can we not block people who want to give us money',
];

export const FLAVOR: [Speaker, string][] = [
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
  /** Code reviews already shown this run, so the same snippet doesn't come back. */
  private reviewed = new Set<string>();

  phase: Phase = 'briefing';
  current: HttpRequest | null = null;
  /** Requests that reached the desk or the rules this shift. */
  index = 0;
  /** Seconds left on the shift clock. When it hits zero, the request on the desk is the last one. */
  clock = 0;
  private dealtAt = 0;
  private plan = new Map<number, GenOptions>();
  private ruleDue = false;
  private patchDue = false;
  ruleEvent?: RuleEvent;
  patchEvent?: PatchEvent;

  private pending: Pending[] = [];
  private collateralHits = 0;
  pings: ChatPing[] = [];
  /** The rule hit on the desk while `phase` is `auto`. */
  autoHit?: AutoBlock;
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

  /** Spend shift-clock time: real time on the desk, plus tool costs. */
  spend(seconds: number): void {
    this.clock = Math.max(0, this.clock - seconds);
  }

  /** Per-request timer for this shift. */
  get seconds(): number {
    return secondsFor(this.cfg, this.shift);
  }

  /** Correct calls needed to finish this shift. */
  get quota(): number {
    return quotaFor(this.cfg, this.shift);
  }

  /** Progress toward the quota: your correct calls plus your rules' catches. */
  get quotaDone(): number {
    return this.stats.correct + this.stats.autoCaught;
  }

  get lastCall(): boolean {
    return this.clock <= 0;
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

    this.clock = this.cfg.shiftSeconds;
    this.plan.clear();
    this.index = 0;
    this.ruleDue = false;
    this.patchDue = false;

    if (this.shift >= 2 && this.shift % 2 === 0) {
      this.ruleDue = true;
      const pool = this.cfg.classes.filter((c): c is Exclude<AttackClass, 'policy'> => c !== 'policy');
      const cls = this.rng.pick(pool);
      this.ruleEvent = { cls, sample: generateRequest(this.ctx(), { kind: 'attack', cls }), testSet: this.testSet(cls) };
      // The wave: extra attacks of the same class spread through the first part of the shift.
      for (let i = 0; i < 4; i++) this.plan.set(this.rng.int(1, 12), { kind: 'attack', cls });
    }

    if (this.cfg.patches) {
      const def = this.pickReview();
      if (def) {
        this.reviewed.add(def.id);
        this.patchDue = true;
        this.patchEvent = { def, order: this.rng.shuffle([0, 1, 2]), classChoices: this.classChoices(def.cls), step: 'verdict' };
      }
    }
    this.phase = 'briefing';
  }

  /** About one review in four is safe code, so "vulnerable" is never a free answer. */
  private pickReview(): PatchDef | undefined {
    const fresh = PATCHES.filter((p) => this.cfg.classes.includes(p.cls) && !this.reviewed.has(p.id));
    const vuln = fresh.filter((p) => p.vulnerable && !this.patched.has(`${p.cls}@${p.endpoint}`));
    const safe = fresh.filter((p) => !p.vulnerable);
    if (safe.length && (!vuln.length || this.rng.chance(0.25))) return this.rng.pick(safe);
    return vuln.length ? this.rng.pick(vuln) : undefined;
  }

  private classChoices(cls: AttackClass): AttackClass[] {
    const others = this.rng.shuffle(this.cfg.classes.filter((c) => c !== cls && REVIEWABLE.has(c)));
    return this.rng.shuffle([cls, ...others.slice(0, 3)]);
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
      if (this.clock <= 0) return this.endShift();
      if (this.ruleDue) {
        this.ruleDue = false;
        this.phase = 'rule';
        this.current = null;
        return;
      }
      if (this.patchDue && this.clock <= this.cfg.shiftSeconds / 2) {
        this.patchDue = false;
        // Make sure the reviewed endpoint gets tested soon after.
        const def = this.patchEvent!.def;
        const cls = def.cls as Exclude<AttackClass, 'policy'>;
        if (def.vulnerable) for (const i of [2, 4]) this.plan.set(this.index + i, { kind: 'attack', cls });
        this.phase = 'patch';
        this.current = null;
        return;
      }
      const req = generateRequest(this.ctx(), this.plan.get(this.index) ?? {});
      this.plan.delete(this.index);
      const rule = this.rules.find((r) => matchRule(r, req));
      if (rule) {
        this.autoBlock(rule, req);
        this.current = req;
        this.phase = 'auto';
        return;
      }
      if (this.rng.chance(0.08)) {
        const [who, text] = this.rng.pick(FLAVOR);
        this.ping(who, tr(text));
      }
      this.current = req;
      this.dealtAt = this.clock;
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
        this.pending.push({ fireIn: 0, meter: 'uptime', who: 'chad', text: tr('your rule "{value}" is blocking real customers. three of them. so far.', { value: rule.value }) });
      }
    }
    if (req.truth.cls) this.seen.add(req.truth.cls);
    this.addScore(points);
    this.autoHit = { rule, req, good, points };
  }

  /** Move on from a rule hit to the next request. */
  ackAuto(): void {
    if (this.phase !== 'auto') throw new Error('no rule hit to acknowledge');
    this.autoHit = undefined;
    this.current = null;
    this.index++;
    this.spend(AUTO_BLOCK_SECONDS);
    this.tick();
    if ((this.phase as Phase) !== 'over') this.advance();
  }

  private addScore(points: number): void {
    this.score += points;
    this.stats.score += points;
  }

  /**
   * Player verdict on the current request. Correct calls earn a speed bonus that
   * fades from full at `parSeconds` to nothing at twice that; `noBonus` skips it (after an undo).
   * `timedOut` means the request timer ran out and the WAF failed open.
   */
  judge(verdict: Verdict, picked?: AttackClass, noBonus = false, timedOut = false): Outcome {
    const req = this.current;
    if (!req || this.phase !== 'request') throw new Error('no request to judge');
    const t = req.truth;
    const took = this.dealtAt - this.clock;
    const par = this.cfg.parSeconds;
    const timeBonus = noBonus || timedOut ? 0 : Math.round(POINTS.speed * Math.max(0, Math.min(1, 2 - took / par)));
    let speedBonus = 0;
    const cls = t.cls ? tr(CLASSES[t.cls].short) : '';
    let kind: OutcomeKind;
    let points: number;
    let title: string;

    if (verdict === 'allow') {
      if (!t.malicious || t.harmless) {
        kind = 'tn';
        speedBonus = timeBonus;
        points = POINTS.allow + (t.bait ? POINTS.bait : 0) + timeBonus;
        title = t.harmless ? tr('200 OK: {cls} bounced off the patch', { cls }) : t.bait ? tr('200 OK: nice, not fooled') : '200 OK';
      } else {
        kind = 'fn';
        points = -30;
        title = timedOut ? tr('Timed out: WAF failed open, {cls} got through', { cls }) : tr('Missed: {cls} got through', { cls });
        const inc = `INC-${this.rng.int(1000, 9999)}: ${tr(INCIDENT_LINES[t.cls!] ?? 'something bad happened')}`;
        this.stats.incidents.push(inc);
        this.total.incidents.push(inc);
        this.pending.push({ fireIn: 2, meter: 'integrity', who: 'ciso', text: tr('{inc}. explain.', { inc }) });
      }
    } else if (t.malicious) {
      if (picked === t.cls) {
        kind = 'tp';
        speedBonus = timeBonus;
        points = POINTS.block + timeBonus;
        title = tr('403 Blocked: {cls}, correct', { cls });
      } else {
        kind = 'wrongclass';
        points = this.cfg.wrongClassPoints;
        title = tr('Blocked, but it was {cls}', { cls });
      }
    } else {
      kind = 'fp';
      points = -15;
      title = t.bait ? tr('False positive: it only looked scary') : tr('False positive: legit customer');
      this.pending.push({ fireIn: 1, meter: 'uptime', who: 'chad', text: tr(this.rng.pick(CHAD_LINES)) });
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
    return { kind, verdict, picked, points, title, truth: t, speedBonus, timedOut };
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
    if (this.integrity <= 0) this.gameOver(tr('Integrity hit zero. The breach made the news, and you made the postmortem.'));
    else if (this.uptime <= 0) this.gameOver(tr('Uptime hit zero. Growth convinced the board to bring back the ML firewall.'));
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
    if (this.phase !== 'over' && this.quotaDone < this.quota) {
      this.gameOver(tr('Quota missed: {done} of {quota} correct calls. HR has scheduled a "quick chat".', { done: this.quotaDone, quota: this.quota }));
    }
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
    this.ping('system', tr('rule {rule} removed', { rule: id }));
  }

  /** Step one of a code review: is this code vulnerable? Returns whether the call was right. */
  reviewVerdict(vulnerable: boolean): boolean {
    const ev = this.patchEvent;
    if (!ev || ev.step !== 'verdict') throw new Error('no review verdict pending');
    ev.saidVulnerable = vulnerable;
    const right = vulnerable === ev.def.vulnerable;
    if (!ev.def.vulnerable) {
      ev.step = 'done';
      if (right) {
        this.addScore(REVIEW_POINTS.safe);
        this.ping('intern', tr('LGTM from security! merging 🎉'));
      } else {
        this.ping('chad', tr('security blocked a perfectly fine PR. the release slips a day.'));
      }
    } else if (right) {
      this.addScore(REVIEW_POINTS.spot);
      ev.step = 'class';
    } else {
      ev.step = 'done';
      this.ping('intern', tr('security said LGTM, shipping it 🚀'));
      this.pending.push({ fireIn: 3, meter: 'integrity', who: 'pentest', text: tr('found {name} in the code you approved for {endpoint}. it was not subtle.', { name: tr(CLASSES[ev.def.cls].name), endpoint: ev.def.endpoint }) });
    }
    return right;
  }

  /** Step two: name the bug. A wrong name costs the points but the review goes on to the fix. */
  reviewClass(cls: AttackClass): boolean {
    const ev = this.patchEvent;
    if (!ev || ev.step !== 'class') throw new Error('no review class pending');
    ev.pickedClass = cls;
    ev.step = 'fix';
    const right = cls === ev.def.cls;
    if (right) this.addScore(REVIEW_POINTS.cls);
    return right;
  }

  /** Step three: approve one of the three PRs. */
  choosePatch(optionIndex: number): PatchOption {
    const ev = this.patchEvent;
    if (!ev || ev.step !== 'fix') throw new Error('no patch choice pending');
    const opt = ev.def.options[optionIndex];
    ev.chosen = opt;
    ev.step = 'done';
    const name = tr(CLASSES[ev.def.cls].short);
    if (opt.kind === 'fix') {
      this.patched.add(`${ev.def.cls}@${ev.def.endpoint}`);
      this.addScore(REVIEW_POINTS.fix);
      this.ping('system', tr('patch deployed to {endpoint}. {name} there is now harmless.', { endpoint: ev.def.endpoint, name }));
    } else if (opt.kind === 'bypassable') {
      this.ping('intern', tr('patch shipped!! 🚀 closing the ticket'));
      this.pending.push({ fireIn: 3, meter: 'integrity', who: 'ciso', text: tr('the {endpoint} patch was bypassed within the hour. a blacklist? really?', { endpoint: ev.def.endpoint }) });
    } else {
      this.pending.push({ fireIn: 0, meter: 'uptime', who: 'chad', text: tr('{endpoint} is broken for every customer since your patch', { endpoint: ev.def.endpoint }) });
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

  directiveTexts(): { id: string; title: string; text: string; isNew: boolean }[] {
    return this.directives.map((id) => {
      const d = directiveById(id);
      return { id, title: d.title, text: d.text, isNew: this.newDirectives.includes(id) };
    });
  }
}
