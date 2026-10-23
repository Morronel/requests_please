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
  secondsStart: number;
  secondsFloor: number;
  maxDirectives: number;
  ruleSlots: number;
  patches: boolean;
  hints: boolean;
  meter: number;
  /** Wrong class on a correct block. */
  wrongClassPoints: number;
  shiftLength: number;
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
    secondsStart: 20,
    secondsFloor: 12,
    maxDirectives: 3,
    ruleSlots: 3,
    patches: false,
    hints: true,
    meter: 5,
    wrongClassPoints: 10,
    shiftLength: 12,
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
    secondsStart: 15,
    secondsFloor: 8,
    maxDirectives: 5,
    ruleSlots: 3,
    patches: true,
    hints: false,
    meter: 4,
    wrongClassPoints: 10,
    shiftLength: 16,
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
    secondsStart: 12,
    secondsFloor: 5,
    maxDirectives: 8,
    ruleSlots: 2,
    patches: true,
    hints: false,
    meter: 3,
    wrongClassPoints: 12,
    shiftLength: 20,
    reputationTells: 0.2,
  },
};

/** Timer shrinks about 5% per shift until the floor. */
export function secondsFor(cfg: DifficultyConfig, shift: number): number {
  return Math.max(cfg.secondsFloor, Math.round(cfg.secondsStart * Math.pow(0.95, shift - 1)));
}

export function shiftLength(cfg: DifficultyConfig, shift: number): number {
  return Math.min(25, cfg.shiftLength + (shift - 1));
}
