import { useEffect, useState } from 'preact/hooks';
import { randomSeed } from '../game/rng';
import { setLang, t } from '../i18n';
import type { Difficulty } from '../game/types';
import { store, type Settings } from '../storage';
import { Codex } from './Codex';
import { Game } from './Game';
import { HowTo } from './HowTo';
import { Menu } from './Menu';

type Screen = { id: 'menu' } | { id: 'howto'; then?: Difficulty } | { id: 'codex' } | { id: 'game'; difficulty: Difficulty; seed: number };

export function App() {
  const [screen, setScreen] = useState<Screen>({ id: 'menu' });
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

  const play = (difficulty: Difficulty) => {
    if (!store.seenIntro) return setScreen({ id: 'howto', then: difficulty });
    setScreen({ id: 'game', difficulty, seed: randomSeed() });
  };

  switch (screen.id) {
    case 'menu':
      return <Menu onPlay={play} onCodex={() => setScreen({ id: 'codex' })} onHowTo={() => setScreen({ id: 'howto' })} settings={settings} onSettings={updateSettings} />;
    case 'howto':
      return (
        <HowTo
          cta={screen.then ? t('Start shift 1') : t('Back')}
          onDone={() => {
            store.markIntroSeen();
            setScreen(screen.then ? { id: 'game', difficulty: screen.then, seed: randomSeed() } : { id: 'menu' });
          }}
        />
      );
    case 'codex':
      return <Codex onBack={() => setScreen({ id: 'menu' })} />;
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
