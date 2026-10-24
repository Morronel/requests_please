import { useEffect, useState } from 'preact/hooks';
import { randomSeed } from '../game/rng';
import { setLang, t } from '../i18n';
import type { Difficulty } from '../game/types';
import { store, type Settings } from '../storage';
import { Codex } from './Codex';
import { Credits } from './Credits';
import { Game } from './Game';
import { HowTo } from './HowTo';
import { Menu } from './Menu';
import { Results } from './Results';
import { StoryMode } from './Story';

type Next = Difficulty | 'story';
type Screen = { id: 'menu' } | { id: 'howto'; then?: Next } | { id: 'codex' } | { id: 'results' } | { id: 'credits' } | { id: 'game'; difficulty: Difficulty; seed: number } | { id: 'story' };

const screenFor = (next: Next): Screen => (next === 'story' ? { id: 'story' } : { id: 'game', difficulty: next, seed: randomSeed() });

export function App() {
  const [screen, setScreen] = useState<Screen>({ id: 'menu' });
  const [endless, setEndless] = useState(false);
  const [settings, setSettings] = useState<Settings>(store.settings);
  // Set before rendering children so every t() call below sees the chosen language.
  setLang(settings.lang);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.classList.toggle('crt', settings.crt);
  }, [settings]);

  const updateSettings = (patch: Partial<Settings>) => {
    store.setSettings(patch);
    setSettings(store.settings);
  };

  const play = (next: Next) => {
    setEndless(next !== 'story');
    if (!store.seenIntro) return setScreen({ id: 'howto', then: next });
    setScreen(screenFor(next));
  };

  switch (screen.id) {
    case 'menu':
      return <Menu onPlay={play} onStory={() => play('story')} endless={endless} onEndless={setEndless} onCodex={() => setScreen({ id: 'codex' })} onResults={() => setScreen({ id: 'results' })} onCredits={() => setScreen({ id: 'credits' })} onHowTo={() => setScreen({ id: 'howto' })} settings={settings} onSettings={updateSettings} />;
    case 'howto':
      return (
        <HowTo
          cta={screen.then === 'story' ? t('Start night 1') : screen.then ? t('Start shift 1') : t('Back')}
          onDone={() => {
            store.markIntroSeen();
            setScreen(screen.then ? screenFor(screen.then) : { id: 'menu' });
          }}
        />
      );
    case 'story':
      return <StoryMode haptics={settings.haptics} onExit={() => setScreen({ id: 'menu' })} />;
    case 'codex':
      return <Codex onBack={() => setScreen({ id: 'menu' })} />;
    case 'results':
      return <Results onBack={() => setScreen({ id: 'menu' })} />;
    case 'credits':
      return <Credits onBack={() => setScreen({ id: 'menu' })} />;
    case 'game':
      return (
        <Game
          key={screen.seed}
          difficulty={screen.difficulty}
          seed={screen.seed}
          haptics={settings.haptics}
          onExit={() => setScreen({ id: 'menu' })}
          onRetry={() => setScreen({ id: 'game', difficulty: screen.difficulty, seed: randomSeed() })}
        />
      );
  }
}
