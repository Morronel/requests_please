import type { AttackClass, Difficulty, Encoding } from './types';

export interface DifficultyConfig {
  id: Difficulty;
  title: string;
  tagline: string;
  classes: AttackClass[];
  /** Max encoding layers stacked on an attack payload. */
  maxLayers: number;
  encodings: Encoding[];
  /** Share of all traffic that is malicious. */
  attackShare: number;
  /** Share of legit traffic that is scary-looking bait. */
  baitShare: number;
  /** Fixed length of every shift on the clock. */
  shiftSeconds: number;
  /** Per-request timer on shift 1; it shrinks 5% per shift down to the floor. Running out fails open. */
  secondsStart: number;
  secondsFloor: number;
  /** Correct calls needed on shift 1 to keep the job; +1 per shift, up to `quotaMax`. */
  quota: number;
  quotaMax: number;
  /** A verdict this fast or faster earns the full speed bonus; slower ones earn less, never a penalty. */
  parSeconds: number;
  maxDirectives: number;
  ruleSlots: number;
  patches: boolean;
  hints: boolean;
  meter: number;
  /** Wrong class on a correct block. */
  wrongClassPoints: number;
  /** How often IP reputation gives the answer away. */
  reputationTells: number;
}

const BASIC: AttackClass[] = ['sqli', 'xss', 'traversal', 'scanner'];
const MEDIUM: AttackClass[] = [...BASIC, 'cmdi', 'ssrf', 'stuffing', 'redirect'];
const HARD: AttackClass[] = [...MEDIUM, 'ssti', 'log4shell', 'xxe', 'jwt', 'smuggling'];

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: {
    id: 'easy',
    title: 'Intern',
    tagline: 'Plain payloads, glowing hints, 5 lives each.',
    classes: BASIC,
    maxLayers: 1,
    encodings: ['url'],
    attackShare: 0.45,
    baitShare: 0.12,
    shiftSeconds: 180,
    secondsStart: 70,
    secondsFloor: 42,
    quota: 8,
    quotaMax: 14,
    parSeconds: 12,
    maxDirectives: 3,
    ruleSlots: 3,
    patches: false,
    hints: true,
    meter: 5,
    wrongClassPoints: 10,
    reputationTells: 0.7,
  },
  medium: {
    id: 'medium',
    title: 'SOC Analyst',
    tagline: 'Double encoding, bait traffic, code patches.',
    classes: MEDIUM,
    maxLayers: 2,
    encodings: ['url', 'base64', 'html'],
    attackShare: 0.5,
    baitShare: 0.25,
    shiftSeconds: 180,
    secondsStart: 52,
    secondsFloor: 28,
    quota: 10,
    quotaMax: 16,
    parSeconds: 9,
    maxDirectives: 5,
    ruleSlots: 3,
    patches: true,
    hints: false,
    meter: 4,
    wrongClassPoints: 10,
    reputationTells: 0.4,
  },
  hard: {
    id: 'hard',
    title: "Red Team's Nightmare",
    tagline: 'Every class, 3-layer encodings, JWTs, smuggling.',
    classes: HARD,
    maxLayers: 3,
    encodings: ['url', 'base64', 'html', 'hex'],
    attackShare: 0.5,
    baitShare: 0.4,
    shiftSeconds: 180,
    secondsStart: 42,
    secondsFloor: 18,
    quota: 12,
    quotaMax: 18,
    parSeconds: 7,
    maxDirectives: 8,
    ruleSlots: 2,
    patches: true,
    hints: false,
    meter: 3,
    wrongClassPoints: 12,
    reputationTells: 0.2,
  },
};

/** Per-request timer, about 3.5x the original pace. Shrinks about 5% per shift until the floor. */
export function secondsFor(cfg: DifficultyConfig, shift: number): number {
  return Math.max(cfg.secondsFloor, Math.round(cfg.secondsStart * Math.pow(0.95, shift - 1)));
}

export function quotaFor(cfg: DifficultyConfig, shift: number): number {
  return Math.min(cfg.quotaMax, cfg.quota + shift - 1);
}
