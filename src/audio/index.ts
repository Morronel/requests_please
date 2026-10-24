import { installUnlock, setMusicVolume, setSfxEnabled } from './context';
import { prefs } from './prefs';
import { syncRadio } from './radio';
import { sfx } from './sfx';

export { prefs, type StationId } from './prefs';
export { radio, type NowPlaying } from './radio';
export { STATIONS } from './tape';
export { sfx };

export function initAudio(): void {
  installUnlock();
  let last = prefs.get();
  prefs.subscribe(() => {
    const p = prefs.get();
    if (p.station !== last.station) syncRadio();
    if (p.volume !== last.volume) setMusicVolume(p.volume);
    if (p.sfx !== last.sfx) setSfxEnabled(p.sfx);
    last = p;
  });
  // One quiet tick for every button, so the screens never feel dead.
  document.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest?.('button')) sfx.tap();
  });
}
