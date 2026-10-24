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

const KEY = 'requests-please:v1';

interface Saved {
  high: Partial<Record<Difficulty, HighScore>>;
  codex: AttackClass[];
  settings: Settings;
  seenIntro: boolean;
}

const DEFAULTS: Saved = {
  high: {},
  codex: [],
  settings: { theme: 'green', crt: true, haptics: true, lang: 'en' },
  seenIntro: false,
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
