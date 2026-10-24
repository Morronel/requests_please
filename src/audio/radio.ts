import { Rng } from '../game/rng';
import { audio, onUnlock } from './context';
import { vinyl, type Kit } from './instruments';
import { prefs, type StationId } from './prefs';
import { RENDERERS, seed, STATIONS, TONE } from './stations';
import { barSeconds, tape, type Bar } from './tape';

export interface NowPlaying {
  station: StationId | null;
  track: string;
  trackNo: number;
  tracks: number;
}

interface Chain {
  out: GainNode;
  tone: BiquadFilterNode;
  kit: Kit;
  stopVinyl?: () => void;
}

const LOOKAHEAD = 0.35;
const tapes = new Map<StationId, Bar[]>();

/**
 * A lookahead scheduler: every 100 ms it renders whole bars that start within
 * the next LOOKAHEAD seconds, directly against the AudioContext clock.
 */
class Radio {
  private id: StationId | null = null;
  private bars: Bar[] = [];
  private idx = 0;
  private next = 0;
  private timer = 0;
  private chain: Chain | null = null;
  private listeners = new Set<(n: NowPlaying) => void>();
  now: NowPlaying = { station: null, track: '', trackNo: 0, tracks: 0 };

  play(id: StationId, track?: number): void {
    const e = audio();
    if (!e) return;
    if (this.id === id && this.chain) return;
    this.teardown();
    this.id = id;
    if (!tapes.has(id)) tapes.set(id, tape(STATIONS[id]));
    this.bars = tapes.get(id)!;
    // Tune in like a real radio: at the top of a random track.
    const start = track ?? Math.floor(Math.random() * STATIONS[id].tracks.length);
    this.idx = this.bars.findIndex((b) => b.track === start);

    const { ctx } = e;
    const tone = TONE[id];
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, ctx.currentTime);
    out.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = tone.open;
    lp.Q.value = 0.5;
    const dry = ctx.createGain();
    const verb = ctx.createConvolver();
    verb.buffer = e.verb;
    const wet = ctx.createGain();
    wet.gain.value = tone.wet;
    dry.connect(lp);
    verb.connect(wet).connect(lp);
    lp.connect(out).connect(e.music);
    const kit: Kit = { ctx, noise: e.noise, dry, wet: verb };
    this.chain = { out, tone: lp, kit };
    if (tone.vinyl) this.chain.stopVinyl = vinyl(kit, ctx.currentTime, tone.vinyl);

    this.next = ctx.currentTime + 0.1;
    this.announce(this.bars[this.idx]);
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 100);
  }

  stop(): void {
    this.teardown();
    this.id = null;
    this.set({ station: null, track: '', trackNo: 0, tracks: 0 });
  }

  /** Jump to the start of the next track. */
  skip(): void {
    if (!this.id || !this.chain) return;
    const cur = this.bars[this.idx].track;
    const nextTrack = (cur + 1) % STATIONS[this.id].tracks.length;
    const id = this.id;
    this.teardown();
    this.id = null;
    this.play(id, nextTrack);
  }

  subscribe(fn: (n: NowPlaying) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private tick(): void {
    const e = audio();
    const chain = this.chain;
    if (!e || !chain || !this.id) return;
    const now = e.ctx.currentTime;
    // Timers stall in background tabs; never try to catch up on missed bars.
    if (this.next < now - 0.05) this.next = now + 0.05;
    while (this.next < now + LOOKAHEAD) {
      const bar = this.bars[this.idx];
      const prev = this.bars[(this.idx + this.bars.length - 1) % this.bars.length];
      const tone = TONE[this.id];
      chain.tone.frequency.setTargetAtTime(bar.section.layers.includes('low') ? tone.low : tone.open, this.next, 0.6);
      RENDERERS[this.id]({ k: chain.kit, t0: this.next, bar, station: STATIONS[this.id], rng: new Rng(seed(bar.track, bar.bar, this.id.length)) });
      if (bar.track !== prev.track && bar.bar === 0) {
        const delay = Math.max(0, (this.next - now) * 1000);
        window.setTimeout(() => this.announce(bar), delay);
      }
      this.next += barSeconds(bar.bpm);
      this.idx = (this.idx + 1) % this.bars.length;
    }
  }

  private announce(bar: Bar): void {
    if (!this.id) return;
    this.set({ station: this.id, track: bar.def.name, trackNo: bar.track + 1, tracks: STATIONS[this.id].tracks.length });
  }

  private set(n: NowPlaying): void {
    this.now = n;
    for (const fn of this.listeners) fn(n);
  }

  private teardown(): void {
    window.clearInterval(this.timer);
    const chain = this.chain;
    const e = audio();
    this.chain = null;
    if (!chain || !e) return;
    const t = e.ctx.currentTime;
    chain.out.gain.cancelScheduledValues(t);
    chain.out.gain.setValueAtTime(chain.out.gain.value, t);
    chain.out.gain.linearRampToValueAtTime(0, t + 0.4);
    window.setTimeout(() => {
      chain.stopVinyl?.();
      chain.out.disconnect();
    }, 700);
  }
}

export const radio = new Radio();

/** Keeps the radio in step with the saved station. */
export function syncRadio(): void {
  const { station } = prefs.get();
  if (station === 'off') radio.stop();
  else radio.play(station);
}

onUnlock(syncRadio);
