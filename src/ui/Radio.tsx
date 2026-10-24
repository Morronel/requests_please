import { useEffect, useState } from 'preact/hooks';
import { prefs, radio, STATIONS, type NowPlaying, type StationId } from '../audio';

const ORDER: (StationId | 'off')[] = ['off', 'lofi', 'dnb', 'jazz'];
const SHORT: Record<StationId | 'off', string> = { off: 'off', lofi: 'lo-fi', dnb: 'dnb', jazz: 'jazz' };

function usePrefs() {
  const [p, setP] = useState(prefs.get());
  useEffect(() => prefs.subscribe(() => setP(prefs.get())), []);
  return p;
}

function useNowPlaying() {
  const [n, setN] = useState<NowPlaying>(radio.now);
  useEffect(() => radio.subscribe(setN), []);
  return n;
}

/** Full radio panel for the menu: station chips, now playing, volume, sfx toggle. */
export function RadioPanel() {
  const p = usePrefs();
  const now = useNowPlaying();
  const st = p.station === 'off' ? null : STATIONS[p.station];
  return (
    <section class="radio">
      <h2 class="label">Radio</h2>
      <div class="radio-stations">
        {ORDER.map((id) => (
          <button class={`chip ${p.station === id ? 'on' : ''}`} onClick={() => prefs.set({ station: id })} aria-pressed={p.station === id}>
            {SHORT[id]}
          </button>
        ))}
      </div>
      <div class="radio-now">
        {st ? (
          <>
            <span class="radio-eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span class="radio-title">
              {st.freq} FM · {now.station ? `${now.trackNo}/${now.tracks} ${now.track}` : 'tap anywhere to tune in'}
            </span>
            <button class="chip" onClick={() => radio.skip()} aria-label="Next track" disabled={!now.station}>
              ⏭
            </button>
          </>
        ) : (
          <span class="muted">radio silence</span>
        )}
      </div>
      <div class="radio-mix">
        <label class="radio-vol">
          <span>vol</span>
          <input type="range" min={0} max={1} step={0.05} value={p.volume} onInput={(e) => prefs.set({ volume: Number((e.target as HTMLInputElement).value) })} />
        </label>
        <button class={`chip ${p.sfx ? 'on' : ''}`} onClick={() => prefs.set({ sfx: !p.sfx })}>
          sfx: {p.sfx ? 'on' : 'off'}
        </button>
      </div>
    </section>
  );
}

/** In-game: one button that flips through the stations. */
export function RadioButton() {
  const p = usePrefs();
  const next = ORDER[(ORDER.indexOf(p.station) + 1) % ORDER.length];
  return (
    <button class={`hud-radio ${p.station === 'off' ? 'off' : ''}`} onClick={() => prefs.set({ station: next })} aria-label={`Radio: ${SHORT[p.station]}. Tap for ${SHORT[next]}`}>
      ♪<span class="hud-radio-name"> {SHORT[p.station]}</span>
    </button>
  );
}
