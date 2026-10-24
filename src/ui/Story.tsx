import { useState } from 'preact/hooks';
import { sfx } from '../audio';
import { endingFor, linesFor, nightDef, nightScenario, NIGHTS, STORY_WHO } from '../game/campaign';
import { randomSeed } from '../game/rng';
import { rankFor } from '../game/run';
import { t } from '../i18n';
import { store } from '../storage';
import { Game } from './Game';

/** Story mode: night briefing with the cast's messages (and a choice), the night itself, then the next one. */
export function StoryMode({ haptics, onExit }: { haptics: boolean; onExit(): void }) {
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);
  const [playing, setPlaying] = useState(false);
  const [seed, setSeed] = useState(randomSeed);
  const c = store.campaign;
  // Game reads the scenario once per seed, so rebuilding it on every render is harmless.
  const scenario = c.night <= NIGHTS ? nightScenario(c.night, c.choices, c.score) : undefined;

  if (!scenario) {
    return (
      <StoryEnding
        onMenu={onExit}
        onRestart={() => {
          store.resetCampaign();
          rerender();
        }}
      />
    );
  }
  if (!playing) {
    return (
      <NightIntro
        onQuit={onExit}
        onChoose={(choice, option) => {
          store.choose(choice, option);
          rerender();
        }}
        onStart={() => {
          setSeed(randomSeed());
          setPlaying(true);
        }}
      />
    );
  }
  return (
    <Game
      key={seed}
      difficulty={scenario.cfg.id}
      seed={seed}
      scenario={scenario}
      haptics={haptics}
      onExit={onExit}
      onRetry={() => setSeed(randomSeed())}
      onNightDone={(run) => {
        store.finishNight(run.score);
        setPlaying(false);
      }}
    />
  );
}

function NightIntro({ onQuit, onChoose, onStart }: { onQuit(): void; onChoose(choice: string, option: string): void; onStart(): void }) {
  const c = store.campaign;
  const def = nightDef(c.night);
  const picked = def.choice ? c.choices[def.choice.id] : undefined;
  const ready = !def.choice || !!picked;
  return (
    <main class="screen story">
      <header class="bar">
        <button class="btn small" onClick={onQuit}>
          ✕ {t('Menu')}
        </button>
        <h1>{t('Night {n} of {total}', { n: c.night, total: NIGHTS })}</h1>
        <span class="muted">{c.score}</span>
      </header>
      <p class="story-title">{t(def.title)}</p>
      <ul class="story-lines">
        {linesFor(def, c.choices).map((l) => (
          <li class={`who-${l.who}`}>
            <b>{t(STORY_WHO[l.who])}</b>
            <span>{t(l.text)}</span>
          </li>
        ))}
      </ul>

      {def.choice && (
        <>
          <h2 class="label">{t('Your call')}</h2>
          <p class="intel">{t(def.choice.prompt)}</p>
          <div class="modes">
            {def.choice.options.map((o) => (
              <button
                class={`mode choice ${picked === o.id ? 'on' : ''}`}
                disabled={!!picked}
                onClick={() => {
                  sfx.deploy();
                  onChoose(def.choice!.id, o.id);
                }}
              >
                <span class="mode-name">
                  <b>{t(o.label)}</b>
                </span>
                <span class="mode-tag">{t(o.effect)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <button class="btn big primary story-go" disabled={!ready} onClick={onStart}>
        {ready ? t('To the desk') : t('Make your call first')}
      </button>
    </main>
  );
}

function StoryEnding({ onMenu, onRestart }: { onMenu(): void; onRestart(): void }) {
  const c = store.campaign;
  const end = endingFor(c.choices);
  return (
    <main class="screen over story-end">
      <pre class="big-stamp ok">MORNING</pre>
      <h1>{t(end.title)}</h1>
      <p>{t(end.text)}</p>
      <p class="muted">{t(end.epilogue)}</p>
      <dl class="stats">
        <dt>{t('Story score')}</dt>
        <dd>{c.score}</dd>
        <dt>{t('Best story score')}</dt>
        <dd>{c.best ?? c.score}</dd>
        <dt>{t('Rank')}</dt>
        <dd class="ok">{t(rankFor(c.score))}</dd>
      </dl>
      <div class="row2 sticky-actions">
        <button class="btn big" onClick={onMenu}>
          {t('Menu')}
        </button>
        <button class="btn big primary" onClick={onRestart}>
          {t('New story')}
        </button>
      </div>
    </main>
  );
}
