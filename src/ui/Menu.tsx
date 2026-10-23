import { CLASSES } from '../game/codex';
import { DIFFICULTIES } from '../game/difficulty';
import type { Difficulty } from '../game/types';
import { store, type Settings } from '../storage';

interface Props {
  onPlay(d: Difficulty): void;
  onCodex(): void;
  onHowTo(): void;
  settings: Settings;
  onSettings(patch: Partial<Settings>): void;
}

const THEMES: Settings['theme'][] = ['green', 'amber', 'ice'];

export function Menu({ onPlay, onCodex, onHowTo, settings, onSettings }: Props) {
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
      <p class="pitch">The board fired the ML firewall. You are the WAF now. Allow the customers, block the hackers, keep both bosses off your back.</p>

      <h2 class="label">Endless mode</h2>
      <div class="modes">
        {(Object.keys(DIFFICULTIES) as Difficulty[]).map((id) => {
          const cfg = DIFFICULTIES[id];
          const hs = store.high[id];
          return (
            <button class={`mode mode-${id}`} onClick={() => onPlay(id)}>
              <span class="mode-name">
                <b>{id.toUpperCase()}</b> <span>{cfg.title}</span>
              </span>
              <span class="mode-tag">{cfg.tagline}</span>
              <span class="mode-hs">{hs ? `best ${hs.score} · shift ${hs.shift} · ${hs.rank}` : 'no runs yet'}</span>
            </button>
          );
        })}
      </div>

      <div class="row2">
        <button class="btn" onClick={onCodex}>
          Codex {store.codex.length}/{total}
        </button>
        <button class="btn" onClick={onHowTo}>
          How to play
        </button>
      </div>

      <div class="settings">
        <button class="chip" onClick={() => onSettings({ theme: THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length] })}>
          theme: {settings.theme}
        </button>
        <button class={`chip ${settings.crt ? 'on' : ''}`} onClick={() => onSettings({ crt: !settings.crt })}>
          crt: {settings.crt ? 'on' : 'off'}
        </button>
        <button class={`chip ${settings.haptics ? 'on' : ''}`} onClick={() => onSettings({ haptics: !settings.haptics })}>
          buzz: {settings.haptics ? 'on' : 'off'}
        </button>
      </div>
      <p class="foot">X-Evil-Bit: 0 · RFC 3514 compliant · no cookies were harmed</p>
    </main>
  );
}
