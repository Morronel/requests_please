import type { AttackClass, Difficulty } from './game/types';
import { detectLang, type Lang } from './i18n';

export interface HighScore {
  score: number;
  shift: number;
  accuracy: number;
  rank: string;
}

/** One finished endless run on the results board. */
export interface BoardEntry extends HighScore {
  /** Shifts that ended in a postmortem. */
  cleared: number;
  /** 'out' when the player clocked out, 'fired' when the run ended them. */
  ended: 'out' | 'fired';
  /** Epoch ms; 0 for a best score carried over from before the board existed. */
  at: number;
}

/** Runs kept per difficulty. */
export const BOARD_SIZE = 10;

export interface Settings {
  theme: 'green' | 'amber' | 'ice';
  crt: boolean;
  haptics: boolean;
  lang: Lang;
}

const KEY = 'requests-please:v1';

interface Saved {
  high: Partial<Record<Difficulty, HighScore>>;
  board: Partial<Record<Difficulty, BoardEntry[]>>;
  codex: AttackClass[];
  settings: Settings;
  seenIntro: boolean;
}

const DEFAULTS: Saved = {
  high: {},
  board: {},
  codex: [],
  settings: { theme: 'green', crt: true, haptics: true, lang: 'en' },
  seenIntro: false,
};

// Storage can be missing or throw (private mode, blocked site data), so every access is guarded.
function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = (raw ? JSON.parse(raw) : {}) as Partial<Saved>;
    const saved: Saved = { ...structuredClone(DEFAULTS), ...parsed, settings: { ...DEFAULTS.settings, lang: detectLang(), ...parsed.settings } };
    // Saves from before the board: seed each board with that difficulty's best score.
    if (!parsed.board) {
      for (const [d, hs] of Object.entries(saved.high) as [Difficulty, HighScore][]) {
        saved.board[d] = [{ ...hs, cleared: Math.max(0, hs.shift - 1), ended: 'fired', at: 0 }];
      }
    }
    return saved;
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
  board(diff: Difficulty): BoardEntry[] {
    return state.board[diff] ?? [];
  },
  /**
   * Put a finished run on the board. `best` is true for a new best on the difficulty, and `place`
   * is the run's 0-based row on the board, or -1 when it didn't make the top BOARD_SIZE.
   */
  recordRun(diff: Difficulty, entry: BoardEntry): { best: boolean; place: number } {
    const prev = state.high[diff];
    const best = !prev || entry.score > prev.score;
    if (best) state.high[diff] = { score: entry.score, shift: entry.shift, accuracy: entry.accuracy, rank: entry.rank };
    const rows = [...this.board(diff)];
    // Ties go to the older run, so a new entry slots in after equal scores.
    let place = rows.findIndex((r) => r.score < entry.score);
    if (place < 0) place = rows.length;
    rows.splice(place, 0, entry);
    state.board[diff] = rows.slice(0, BOARD_SIZE);
    save();
    return { best, place: place < BOARD_SIZE ? place : -1 };
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
