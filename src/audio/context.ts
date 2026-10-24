import { prefs } from './prefs';

/**
 * One shared AudioContext with three buses:
 * music (station mix, glued by a compressor) and sfx both feed the master.
 * Browsers only allow audio after a user gesture, so the context is created lazily.
 */
export interface Engine {
  ctx: AudioContext;
  music: AudioNode;
  sfx: GainNode;
  noise: AudioBuffer;
  verb: AudioBuffer;
}

let engine: Engine | null = null;

export function audio(): Engine | null {
  if (engine) return engine;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    const ctx = new Ctor({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.ratio.value = 3;
    glue.attack.value = 0.01;
    glue.release.value = 0.25;
    const music = ctx.createGain();
    music.gain.value = curve(prefs.get().volume);
    glue.connect(music).connect(master);

    const sfx = ctx.createGain();
    sfx.gain.value = prefs.get().sfx ? 0.55 : 0;
    sfx.connect(master);

    engine = { ctx, music: glue, sfx, noise: makeNoise(ctx), verb: makeImpulse(ctx, 1.6) };
    musicLevel = music;
    return engine;
  } catch {
    return null;
  }
}

let musicLevel: GainNode | null = null;

/** Perceived loudness is roughly logarithmic, so the slider is squared. */
function curve(v: number): number {
  return v * v * 0.8;
}

export function setMusicVolume(v: number): void {
  if (!engine || !musicLevel) return;
  musicLevel.gain.setTargetAtTime(curve(v), engine.ctx.currentTime, 0.05);
}

export function setSfxEnabled(on: boolean): void {
  if (!engine) return;
  engine.sfx.gain.setTargetAtTime(on ? 0.55 : 0, engine.ctx.currentTime, 0.02);
}

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** A stereo noise tail with exponential decay: a cheap, decent room. */
function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return buf;
}

const unlockListeners: (() => void)[] = [];

/** Runs `fn` after the first user gesture has unlocked audio. */
export function onUnlock(fn: () => void): void {
  unlockListeners.push(fn);
}

let unlocked = false;

export function installUnlock(): void {
  const unlock = () => {
    const e = audio();
    if (!e) return;
    void e.ctx.resume();
    if (unlocked) return;
    unlocked = true;
    for (const fn of unlockListeners) fn();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true, passive: true });

  // Nobody wants a radio playing from a pocket: pause with the tab.
  document.addEventListener('visibilitychange', () => {
    if (!engine) return;
    if (document.hidden) void engine.ctx.suspend();
    else if (unlocked) void engine.ctx.resume();
  });
}

export function isUnlocked(): boolean {
  return unlocked;
}
