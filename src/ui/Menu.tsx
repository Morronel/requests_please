import { useState } from 'preact/hooks';
import { NIGHTS } from '../game/campaign';
import { CLASSES } from '../game/codex';
import { DIFFICULTIES } from '../game/difficulty';
import { LANG_NAME, t } from '../i18n';
import type { Difficulty } from '../game/types';
import { store, type Settings } from '../storage';
import { RadioPanel } from './Radio';

interface Props {
  onPlay(d: Difficulty): void;
  onStory(): void;
  /** Open on the difficulty list, e.g. when coming back from an endless run. */
  endless: boolean;
  onEndless(open: boolean): void;
  onCodex(): void;
  onResults(): void;
  onCredits(): void;
  onHowTo(): void;
  settings: Settings;
  onSettings(patch: Partial<Settings>): void;
}

const THEMES: Settings['theme'][] = ['green', 'amber', 'ice'];

function storyStatus(): string {
  const c = store.campaign;
  if (c.night > NIGHTS) return t('finished · {score} · best {best}', { score: c.score, best: c.best ?? c.score });
  if (c.night === 1 && !Object.keys(c.choices).length) return t('{n} nights, one difficulty curve, your choices matter', { n: NIGHTS });
  return t('continue: night {n} of {total} · {score}', { n: c.night, total: NIGHTS, score: c.score });
}

export function Menu({ onPlay, onStory, endless, onEndless: setEndless, onCodex, onResults, onCredits, onHowTo, settings, onSettings }: Props) {
  const total = Object.keys(CLASSES).length;
  const [confirmReset, setConfirmReset] = useState(false);
  const c = store.campaign;
  const started = c.night > 1 || Object.keys(c.choices).length > 0;
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

      {endless ? (
        <>
          <div class="bar mode-head">
            <h2 class="label">{t('Endless mode')}</h2>
            <button class="btn small" onClick={() => setEndless(false)}>
              ← {t('Back')}
            </button>
          </div>
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
        </>
      ) : (
        <div class="modes">
          <button class="mode mode-story" onClick={onStory}>
            <span class="mode-name">
              <b>{t('STORY MODE')}</b> <span>{t('Hypercart vs Null Route')}</span>
            </span>
            <span class="mode-tag">{t('Fifteen nights from intern to last line of defence. Meters refill every night.')}</span>
            <span class="mode-hs">{storyStatus()}</span>
          </button>
          <button class="mode mode-endless" onClick={() => setEndless(true)}>
            <span class="mode-name">
              <b>{t('ENDLESS MODE')}</b> <span>{t('Easy, Medium or Hard')}</span>
            </span>
            <span class="mode-tag">{t('Shift after shift until you get fired. Chase the high score.')}</span>
          </button>
          {started && (
            <button
              class="chip"
              onClick={() => {
                if (!confirmReset) return setConfirmReset(true);
                store.resetCampaign();
                setConfirmReset(false);
              }}
            >
              {confirmReset ? t('Tap again to wipe story progress') : t('Restart story')}
            </button>
          )}
        </div>
      )}

      <div class="row2">
        <button class="btn" onClick={onCodex}>
          {t('Codex')} {store.codex.length}/{total}
        </button>
        <button class="btn" onClick={onResults}>
          {t('Results')}
        </button>
      </div>
      <div class="row2">
        <button class="btn" onClick={onHowTo}>
          {t('How to play')}
        </button>
        <button class="btn" onClick={onCredits}>
          {t('Credits')}
        </button>
      </div>

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
