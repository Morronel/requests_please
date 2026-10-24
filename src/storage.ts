import { NIGHTS } from './game/campaign';
import type { AttackClass, Difficulty } from './game/types';
import { detectLang, type Lang } from './i18n';

export interface HighScore {
  score: number;
  shift: number;
  accuracy: number;
  rank: string;
}

export interface Settings {
  theme: 'green' | 'amber' | 'ice';
  crt: boolean;
  haptics: boolean;
  lang: Lang;
}

/** Story progress. Meters refill every night, so the night, the banked score and the choices are enough. */
export interface Campaign {
  /** Next night to play, 1-15; 16 means the story is finished. */
  night: number;
  /** Score banked from finished nights. */
  score: number;
  choices: Record<string, string>;
  /** Best finished-story score. */
  best?: number;
}

const NEW_CAMPAIGN: Campaign = { night: 1, score: 0, choices: {} };

const KEY = 'requests-please:v1';

interface Saved {
  high: Partial<Record<Difficulty, HighScore>>;
  codex: AttackClass[];
  settings: Settings;
  seenIntro: boolean;
  campaign: Campaign;
}

const DEFAULTS: Saved = {
  high: {},
  codex: [],
  settings: { theme: 'green', crt: true, haptics: true, lang: 'en' },
  seenIntro: false,
  campaign: NEW_CAMPAIGN,
};

// Storage can be missing or throw (private mode, blocked site data), so every access is guarded.
function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = (raw ? JSON.parse(raw) : {}) as Partial<Saved>;
    return { ...structuredClone(DEFAULTS), ...parsed, settings: { ...DEFAULTS.settings, lang: detectLang(), ...parsed.settings } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

let state = load();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Not fatal: the game just forgets between visits.
  }
}

export const store = {
  get high() {
    return state.high;
  },
  get codex() {
    return state.codex;
  },
  get settings() {
    return state.settings;
  },
  get seenIntro() {
    return state.seenIntro;
  },
  get campaign(): Campaign {
    return state.campaign;
  },
  /** Bank a finished night: move to the next one with the new total. */
  finishNight(score: number) {
    const c = state.campaign;
    c.night++;
    c.score = score;
    if (c.night > NIGHTS) c.best = Math.max(c.best ?? 0, score);
    save();
  },
  choose(choice: string, option: string) {
    state.campaign.choices = { ...state.campaign.choices, [choice]: option };
    save();
  },
  /** Start the story over, keeping the best score. */
  resetCampaign() {
    state.campaign = { ...structuredClone(NEW_CAMPAIGN), best: state.campaign.best };
    save();
  },
  markIntroSeen() {
    state.seenIntro = true;
    save();
  },
  /** Returns true when this is a new best for the difficulty. */
  submitScore(diff: Difficulty, hs: HighScore): boolean {
    const prev = state.high[diff];
    if (prev && prev.score >= hs.score) return false;
    state.high[diff] = hs;
    save();
    return true;
  },
  unlock(classes: Iterable<AttackClass>): AttackClass[] {
    const fresh: AttackClass[] = [];
    for (const c of classes) {
      if (!state.codex.includes(c)) {
        state.codex.push(c);
        fresh.push(c);
      }
    }
    if (fresh.length) save();
    return fresh;
  },
  setSettings(patch: Partial<Settings>) {
    state.settings = { ...state.settings, ...patch };
    save();
  },
};
