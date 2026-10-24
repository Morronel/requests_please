import { UK } from './uk';

export type Lang = 'en' | 'uk';

export const LANG_NAME: Record<Lang, string> = { en: 'English', uk: 'Українська' };

let current: Lang = 'en';

export function setLang(lang: Lang): void {
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

export function getLang(): Lang {
  return current;
}

/** First visit: Ukrainian if the browser asks for it, English otherwise. */
export function detectLang(): Lang {
  try {
    return navigator.languages?.some((l) => l.toLowerCase().startsWith('uk')) ? 'uk' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * gettext-style lookup: the English text is the key, so English needs no table and a missing
 * translation falls back to English. `{name}` placeholders are filled from params.
 * HTTP requests themselves are never translated.
 */
export function t(text: string, params?: Record<string, string | number>): string {
  const s = current === 'uk' ? (UK[text] ?? text) : text;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m: string, k: string) => (k in params ? String(params[k]) : m));
}

const PATCHED_SUFFIX = ' The endpoint is patched, so it bounces off harmlessly.';

/** Verdict explanations come from static template text, plus a suffix once the endpoint is patched. */
export function explain(text: string): string {
  if (!text.endsWith(PATCHED_SUFFIX)) return t(text);
  return t(text.slice(0, -PATCHED_SUFFIX.length)) + ' ' + t(PATCHED_SUFFIX.trim());
}
