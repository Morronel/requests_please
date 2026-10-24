import { DIFFICULTIES, type DifficultyConfig } from './difficulty';
import type { Scenario } from './run';
import type { AttackClass, Difficulty, Encoding } from './types';

/**
 * Story mode: 15 authored nights on one difficulty curve, from endless Easy on night 1
 * to endless Hard (and a bit past it) on night 15. Every night is one shift, and the
 * meters refill between nights. Three choices change later nights and the ending.
 */

export const NIGHTS = 15;

export type StoryWho = 'ciso' | 'chad' | 'intern' | 'crew' | 'system';

export const STORY_WHO: Record<StoryWho, string> = {
  ciso: 'CISO',
  chad: 'Chad (Growth)',
  intern: 'intern',
  crew: 'Null Route',
  system: 'edge-node-7',
};

/** Choice id → picked option id. */
export type Choices = Record<string, string>;

export interface StoryLine {
  who: StoryWho;
  text: string;
  /** Only shown when this choice was made, as [choice id, option id]. */
  when?: [string, string];
}

export interface ChoiceOption {
  id: string;
  label: string;
  effect: string;
}

export interface StoryChoice {
  id: string;
  prompt: string;
  options: [ChoiceOption, ChoiceOption];
}

type Cls = Exclude<AttackClass, 'policy'>;

export interface NightDef {
  n: number;
  title: string;
  lines: StoryLine[];
  /** Asked before the night starts; the answer applies from this night on. */
  choice?: StoryChoice;
  classes: Cls[];
  directives: string[];
  /** Threat intel: a rule-writing event and a wave of this class. */
  wave?: Cls;
}

const BASIC: Cls[] = ['sqli', 'xss', 'traversal', 'scanner'];
const MEDIUM: Cls[] = [...BASIC, 'cmdi', 'ssrf', 'stuffing', 'redirect'];
const HARD: Cls[] = [...MEDIUM, 'ssti', 'log4shell', 'xxe', 'jwt', 'smuggling'];

export const STORY: NightDef[] = [
  {
    n: 1,
    title: 'Night one',
    lines: [
      { who: 'ciso', text: "Welcome to Hypercart. The board fired the ML firewall after it blocked the CEO's mom. You are the WAF now." },
      { who: 'ciso', text: 'Tonight is gentle: SQL injection and XSS only. Allow the customers, block the rest, and tell me what you blocked.' },
      { who: 'intern', text: "hi!! i'm the intern. if anything breaks it was probably me" },
    ],
    classes: ['sqli', 'xss'],
    directives: [],
  },
  {
    n: 2,
    title: 'Dot dot slash',
    lines: [
      { who: 'ciso', text: 'Someone tried to read /etc/passwd last night. Path traversal is on your list now.' },
      { who: 'ciso', text: 'First directive: /admin is office-only. Read the briefing every night, the rules change.' },
      { who: 'chad', text: 'hey new WAF person! remember, every blocked request is a lost sale 🙏' },
    ],
    classes: ['sqli', 'xss', 'traversal'],
    directives: ['admin-internal'],
  },
  {
    n: 3,
    title: 'Knock knock',
    lines: [
      { who: 'system', text: 'Scanner fingerprints up 400% since midnight.' },
      { who: 'ciso', text: 'Somebody is mapping us. Scanners are fair game. A SQLi wave is coming too, so write a rule for it.' },
      { who: 'intern', text: 'the scanner left a note in its User-Agent. it says "see you soon". is that bad' },
    ],
    classes: BASIC,
    directives: ['admin-internal', 'no-trace'],
    wave: 'sqli',
  },
  {
    n: 4,
    title: 'Training wheels off',
    lines: [
      { who: 'ciso', text: 'The glowing hints are gone. You know what bad looks like by now.' },
      { who: 'chad', text: "Black Friday is tomorrow. please don't block Black Friday." },
      { who: 'crew', text: 'nice WAF. would be a shame if someone tested it.' },
    ],
    classes: BASIC,
    directives: ['admin-internal', 'no-trace', 'ua-required'],
  },
  {
    n: 5,
    title: 'Black Friday',
    lines: [
      { who: 'chad', text: 'BLACK FRIDAY! Traffic is 5x. Every false positive costs us real money tonight.' },
      { who: 'ciso', text: 'Null Route picked tonight on purpose. Command injection is in play, and an XSS wave is on its way.' },
    ],
    choice: {
      id: 'friday',
      prompt: 'Chad wants the WAF relaxed for the sale. The CISO wants a lockdown. Who do you back?',
      options: [
        { id: 'growth', label: 'Back Chad: relax the gate', effect: 'Quota −1 every night, but more attacks reach your desk.' },
        { id: 'lockdown', label: 'Back the CISO: lock it down', effect: 'Quota +1 every night, but the CISO buys a threat feed: IP reputation tells you more.' },
      ],
    },
    classes: [...BASIC, 'cmdi'],
    directives: ['admin-internal', 'no-trace', 'ua-required', 'freedonia'],
    wave: 'xss',
  },
  {
    n: 6,
    title: 'Cyber Monday',
    lines: [
      { who: 'chad', text: "record sales!! you're my favourite firewall. the CISO is not talking to me.", when: ['friday', 'growth'] },
      { who: 'ciso', text: 'Good call on Friday. The threat feed is live, so IP reputation is more honest now.', when: ['friday', 'lockdown'] },
      { who: 'ciso', text: 'SSRF tonight: they want our cloud metadata. Expect a command-injection wave, and the devs will send you a patch to review.' },
    ],
    classes: [...BASIC, 'cmdi', 'ssrf'],
    directives: ['admin-internal', 'ua-required', 'freedonia', 'debug-param'],
    wave: 'cmdi',
  },
  {
    n: 7,
    title: 'Credential season',
    lines: [
      { who: 'system', text: '47,000 failed logins in an hour. Same passwords, different usernames.' },
      { who: 'ciso', text: 'Credential stuffing. Watch the request rate, not the payload. And fraud wants Tor out of checkout.' },
    ],
    classes: [...BASIC, 'cmdi', 'ssrf', 'stuffing'],
    directives: ['admin-internal', 'ua-required', 'freedonia', 'debug-param', 'tor'],
    wave: 'stuffing',
  },
  {
    n: 8,
    title: "The intern's commit",
    lines: [
      { who: 'intern', text: "ok so. i may have pushed the prod database password to a public repo. at 4pm. it's 2am now" },
      { who: 'intern', text: "please don't tell the CISO 🥺" },
      { who: 'ciso', text: 'Open redirects are up. Someone is phishing our users through our own login page.' },
    ],
    choice: {
      id: 'intern',
      prompt: 'The intern leaked a password. Do you cover for them or report it?',
      options: [
        { id: 'cover', label: 'Cover for the intern', effect: 'You rotate it quietly. The intern owes you and starts tagging bad IPs: IP reputation tells you more.' },
        { id: 'report', label: 'Report it to the CISO', effect: 'Process wins. The CISO trusts you: one extra Integrity and Uptime every night.' },
      ],
    },
    classes: MEDIUM,
    directives: ['admin-internal', 'freedonia', 'debug-param', 'tor', 'billing-freeze'],
  },
  {
    n: 9,
    title: 'Curly braces',
    lines: [
      { who: 'intern', text: "rotated the password!! properly this time. i'm tagging bad IPs for you now ❤", when: ['intern', 'cover'] },
      { who: 'ciso', text: "Thanks for the report. The intern is on mandatory training, and you've earned some slack.", when: ['intern', 'report'] },
      { who: 'ciso', text: 'Template injection hit the email renderer. {{7*7}} is not a maths quiz. SSRF wave incoming.' },
    ],
    classes: [...MEDIUM, 'ssti'],
    directives: ['admin-internal', 'freedonia', 'debug-param', 'tor', 'billing-freeze', 'upload-limit'],
    wave: 'ssrf',
  },
  {
    n: 10,
    title: 'Blameless',
    lines: [
      { who: 'crew', text: 'we read your blameless postmortems. very blameless. see you tonight.' },
      { who: 'ciso', text: 'Log4Shell is back, because someone always forgets a jar. And API v1 dies tonight.' },
    ],
    classes: [...MEDIUM, 'ssti', 'log4shell'],
    directives: ['admin-internal', 'freedonia', 'tor', 'billing-freeze', 'upload-limit', 'v1-deprecated'],
    wave: 'log4shell',
  },
  {
    n: 11,
    title: 'Invoices',
    lines: [
      { who: 'ciso', text: 'XXE through the invoice upload. If the XML brings a DOCTYPE, read it twice.' },
      { who: 'chad', text: 'can the WAF go a bit faster? the CEO noticed the queue' },
    ],
    classes: [...MEDIUM, 'ssti', 'log4shell', 'xxe'],
    directives: ['admin-internal', 'freedonia', 'tor', 'billing-freeze', 'upload-limit', 'v1-deprecated', 'no-trace'],
  },
  {
    n: 12,
    title: 'The offer',
    lines: [
      { who: 'crew', text: "you're good. too good for Hypercart. join us: you keep the job, we just need a few gaps." },
      { who: 'crew', text: "think about it. we'll know your answer by what gets through." },
      { who: 'ciso', text: 'Forged JWTs tonight. alg:none is never a real customer. XXE wave on the way.' },
    ],
    choice: {
      id: 'crew',
      prompt: 'Null Route wants you on the inside. What do you do?',
      options: [
        { id: 'decline', label: 'Decline and report it', effect: 'The CISO is impressed: one extra rule slot for the rest of the story.' },
        { id: 'double', label: 'Play along, give them nothing', effect: 'You pretend to join. Their "tips" give the decoys away: less bait traffic from now on.' },
      ],
    },
    classes: [...MEDIUM, 'ssti', 'log4shell', 'xxe', 'jwt'],
    directives: ['admin-internal', 'freedonia', 'tor', 'billing-freeze', 'upload-limit', 'v1-deprecated', 'no-trace'],
    wave: 'xxe',
  },
  {
    n: 13,
    title: 'Smuggled',
    lines: [
      { who: 'crew', text: 'welcome aboard. tip: the scary-looking stuff tonight is fake. the real hit is in the headers.', when: ['crew', 'double'] },
      { who: 'ciso', text: 'Reported, logged and passed to the FBI. Have a spare rule slot on me.', when: ['crew', 'decline'] },
      { who: 'ciso', text: 'Request smuggling: Content-Length and Transfer-Encoding disagree. Every class is live from now on.' },
    ],
    classes: HARD,
    directives: ['admin-internal', 'freedonia', 'tor', 'billing-freeze', 'v1-deprecated', 'no-trace', 'api-key'],
    wave: 'jwt',
  },
  {
    n: 14,
    title: 'Dress rehearsal',
    lines: [
      { who: 'system', text: 'Null Route traffic up 900%. A botnet is warming up.' },
      { who: 'ciso', text: 'Tomorrow is the big one. Tonight is the rehearsal: every encoding, every trick.' },
      { who: 'intern', text: 'i made you coffee. it is mostly espresso. good luck', when: ['intern', 'cover'] },
    ],
    classes: HARD,
    directives: ['admin-internal', 'freedonia', 'tor', 'billing-freeze', 'upload-limit', 'v1-deprecated', 'no-trace', 'api-key'],
    wave: 'smuggling',
  },
  {
    n: 15,
    title: 'Null Route',
    lines: [
      { who: 'crew', text: "last night, Hypercart. let's see your WAF.", when: ['crew', 'decline'] },
      { who: 'crew', text: "tonight's the night, partner. leave the door open.", when: ['crew', 'double'] },
      { who: 'ciso', text: 'This is it. Hold the line until morning.' },
      { who: 'chad', text: 'also please do not block any customers. thanks' },
    ],
    classes: HARD,
    directives: ['admin-internal', 'freedonia', 'tor', 'billing-freeze', 'upload-limit', 'v1-deprecated', 'ua-required', 'api-key'],
    wave: 'sqli',
  },
];

export interface Ending {
  title: string;
  text: string;
  epilogue: string;
}

export const ENDINGS: Record<'double' | 'lockdown' | 'growth', Omit<Ending, 'epilogue'>> = {
  double: {
    title: 'Double agent',
    text: "Null Route fed you their whole playbook, sure you'd let it through. You blocked every line of it. The FBI sends a fruit basket. Null Route sends a much less polite message.",
  },
  lockdown: {
    title: 'Head of Edge Security',
    text: 'Hypercart made it to morning. The CISO puts your name on the promotion memo, and the ML firewall is officially never coming back.',
  },
  growth: {
    title: 'Employee of the Month',
    text: 'Hypercart made it to morning, and Chad presents the night to the board as a Growth win. You get a mug. It says "Growth".',
  },
};

export const EPILOGUES = {
  cover: 'The intern is a junior security engineer now. They still deploy on Fridays.',
  report: 'The intern finished security training with distinction and now reports everyone. Including you.',
};

export function endingFor(choices: Choices): Ending {
  const key = choices.crew === 'double' ? 'double' : choices.friday === 'growth' ? 'growth' : 'lockdown';
  return { ...ENDINGS[key], epilogue: choices.intern === 'cover' ? EPILOGUES.cover : EPILOGUES.report };
}

export function nightDef(n: number): NightDef {
  const def = STORY[n - 1];
  if (!def) throw new Error(`no night ${n}`);
  return def;
}

export function linesFor(def: NightDef, choices: Choices): StoryLine[] {
  return def.lines.filter((l) => !l.when || choices[l.when[0]] === l.when[1]);
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

function encodingsFor(n: number): Encoding[] {
  if (n <= 4) return ['url'];
  if (n <= 7) return ['url', 'base64'];
  if (n <= 10) return ['url', 'base64', 'html'];
  return ['url', 'base64', 'html', 'hex'];
}

/** The difficulty curve: endless Easy on night 1, endless Hard on night 15, branch effects on top. */
export function nightConfig(n: number, choices: Choices = {}): DifficultyConfig {
  const def = nightDef(n);
  const p = (n - 1) / (NIGHTS - 1);
  const easy = DIFFICULTIES.easy;
  const hard = DIFFICULTIES.hard;
  const band: Difficulty = n <= 5 ? 'easy' : n <= 10 ? 'medium' : 'hard';
  const has = (id: string, opt: string) => choices[id] === opt;

  let quota = Math.round(lerp(easy.quota, hard.quotaMax - 2, p));
  if (has('friday', 'growth')) quota -= 1;
  if (has('friday', 'lockdown')) quota += 1;
  let attackShare = lerp(easy.attackShare, hard.attackShare, p);
  if (has('friday', 'growth')) attackShare += 0.05;
  let baitShare = lerp(easy.baitShare, hard.baitShare, p);
  if (has('crew', 'double')) baitShare -= 0.12;
  let reputationTells = lerp(easy.reputationTells, hard.reputationTells, p);
  if (has('friday', 'lockdown')) reputationTells += 0.15;
  if (has('intern', 'cover')) reputationTells += 0.1;
  const meter = (n <= 5 ? 5 : n <= 10 ? 4 : 3) + (has('intern', 'report') ? 1 : 0);
  const ruleSlots = (n <= 10 ? 3 : 2) + (has('crew', 'decline') ? 1 : 0);

  return {
    id: band,
    title: def.title,
    tagline: '',
    classes: def.classes,
    maxLayers: n <= 4 ? 1 : n <= 10 ? 2 : 3,
    encodings: encodingsFor(n),
    attackShare: Math.min(0.6, attackShare),
    baitShare: Math.max(0.05, baitShare),
    shiftSeconds: easy.shiftSeconds,
    // Night 15 runs a bit tighter than Hard's first shift: it's the finale.
    secondsStart: Math.round(lerp(easy.secondsStart, hard.secondsStart - 8, p)),
    secondsFloor: hard.secondsFloor,
    quota,
    quotaMax: quota,
    parSeconds: Math.round(lerp(easy.parSeconds, hard.parSeconds, p)),
    maxDirectives: def.directives.length,
    ruleSlots,
    patches: n >= 6,
    hints: n <= 3,
    meter,
    wrongClassPoints: Math.round(lerp(easy.wrongClassPoints, hard.wrongClassPoints, p)),
    reputationTells: Math.min(0.9, reputationTells),
  };
}

/** Everything a Run needs to play night `n`, carrying the story score so far. */
export function nightScenario(n: number, choices: Choices, carried: number): Scenario {
  const def = nightDef(n);
  return {
    cfg: nightConfig(n, choices),
    night: n,
    directives: def.directives,
    previous: n > 1 ? nightDef(n - 1).directives : [],
    wave: def.wave,
    carried,
  };
}

/** Every story string the player can see, for the translation check. */
export function storyStrings(): string[] {
  return [
    ...Object.values(STORY_WHO),
    ...STORY.flatMap((d) => [d.title, ...d.lines.map((l) => l.text), ...(d.choice ? [d.choice.prompt, ...d.choice.options.flatMap((o) => [o.label, o.effect])] : [])]),
    ...Object.values(ENDINGS).flatMap((e) => [e.title, e.text]),
    ...Object.values(EPILOGUES),
  ];
}
