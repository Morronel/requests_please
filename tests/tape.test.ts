import { describe, expect, it } from 'vitest';
import { barSeconds, STATIONS, tape, tapeSeconds, TRACK_SECONDS, voice } from '../src/audio/tape';

describe('radio tapes', () => {
  for (const st of Object.values(STATIONS)) {
    it(`${st.id}: about ten minutes, four tracks`, () => {
      const bars = tape(st);
      const secs = tapeSeconds(bars);
      expect(secs).toBeGreaterThan(9 * 60);
      expect(secs).toBeLessThan(12 * 60);
      expect(new Set(bars.map((b) => b.track)).size).toBe(4);
    });

    it(`${st.id}: tracks have an intro and outro and sections never straddle a progression`, () => {
      const bars = tape(st);
      for (let t = 0; t < st.tracks.length; t++) {
        const tb = bars.filter((b) => b.track === t);
        expect(tb[0].section.name).toBe(st.tracks[t].intro[0].name);
        expect(tb.at(-1)!.section.name).toBe(st.tracks[t].outro.at(-1)!.name);
        expect(tb.reduce((s, b) => s + barSeconds(b.bpm), 0)).toBeGreaterThanOrEqual(TRACK_SECONDS);
        for (const b of tb) if (b.barInSection === 0) expect(b.cycleBar).toBe(0);
      }
    });
  }

  it('close voicings stay inside one octave', () => {
    for (const b of tape(STATIONS.jazz)) {
      const v = voice(b.chord, 55);
      expect(v[0]).toBeGreaterThanOrEqual(55);
      expect(v.at(-1)!).toBeLessThan(67);
    }
  });
});
