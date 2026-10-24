import { CLASSES } from '../game/codex';
import { DIFFICULTIES } from '../game/difficulty';
import { LANG_NAME, t } from '../i18n';
import type { Difficulty } from '../game/types';
import { store, type Settings } from '../storage';
import { RadioPanel } from './Radio';

interface Props {
  onPlay(d: Difficulty): void;
  onCodex(): void;
  onResults(): void;
  onHowTo(): void;
  settings: Settings;
  onSettings(patch: Partial<Settings>): void;
}

const THEMES: Settings['theme'][] = ['green', 'amber', 'ice'];

export function Menu({ onPlay, onCodex, onResults, onHowTo, settings, onSettings }: Props) {
  const total = Object.keys(CLASSES).length;
  return (
    <main class="screen menu">
      <h1 class="logo">
        <span>REQUESTS,</span>
        <span>
          PLEASE<span class="blink">_</span>
        </span>
      </h1>
      <p class="sub">
        root@edge-node-7:~$ ./waf --mode=human
      </p>
      <p class="pitch">{t('The board fired the ML firewall. You are the WAF now. Allow the customers, block the hackers, keep both bosses off your back.')}</p>

      <h2 class="label">{t('Endless mode')}</h2>
      <div class="modes">
        {(Object.keys(DIFFICULTIES) as Difficulty[]).map((id) => {
          const cfg = DIFFICULTIES[id];
          const hs = store.high[id];
          return (
            <button class={`mode mode-${id}`} onClick={() => onPlay(id)}>
              <span class="mode-name">
                <b>{t(id.toUpperCase())}</b> <span>{t(cfg.title)}</span>
              </span>
              <span class="mode-tag">{t(cfg.tagline)}</span>
              <span class="mode-hs">{hs ? t('best {score} · shift {shift} · {rank}', { score: hs.score, shift: hs.shift, rank: t(hs.rank) }) : t('no runs yet')}</span>
            </button>
          );
        })}
      </div>

      <div class="row2">
        <button class="btn" onClick={onCodex}>
          {t('Codex')} {store.codex.length}/{total}
        </button>
        <button class="btn" onClick={onResults}>
          {t('Results')}
        </button>
      </div>
      <button class="btn wide" onClick={onHowTo}>
        {t('How to play')}
      </button>

      <div class="settings">
        <button class="chip" onClick={() => onSettings({ theme: THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length] })}>
          {t('theme: {name}', { name: t(settings.theme) })}
        </button>
        <button class={`chip ${settings.crt ? 'on' : ''}`} onClick={() => onSettings({ crt: !settings.crt })}>
          {t('crt: {state}', { state: t(settings.crt ? 'on' : 'off') })}
        </button>
        <button class={`chip ${settings.haptics ? 'on' : ''}`} onClick={() => onSettings({ haptics: !settings.haptics })}>
          {t('buzz: {state}', { state: t(settings.haptics ? 'on' : 'off') })}
        </button>
        <button class="chip" onClick={() => onSettings({ lang: settings.lang === 'en' ? 'uk' : 'en' })} aria-label="Language / Мова">
          🌐 {LANG_NAME[settings.lang]}
        </button>
      </div>
      <RadioPanel />
      <p class="foot">{t('X-Evil-Bit: 0 · RFC 3514 compliant · no cookies were harmed')}</p>
    </main>
  );
}
