/**
 * A fixture track for the montage tests: low-passed mono s16le at 8 kHz, as
 * readEnvelopes() gives it. Kicks at `bpm` (a 55 Hz burst decaying over 120
 * ms) from 0 s, a breakdown with no kick for the 8 beats before the drop,
 * and the kick back on the drop.
 */

export function fixtureTrack(opts: { bpm?: number; dropS?: number; durationS?: number; firstKickS?: number; sampleRate?: number } = {}): {
  pcm: Uint8Array;
  kicksS: number[];
  dropS: number;
  periodS: number;
} {
  const bpm = opts.bpm ?? 126;
  const sr = opts.sampleRate ?? 8000;
  const period = 60 / bpm;
  const first = opts.firstKickS ?? 0.1;
  const durationS = opts.durationS ?? 60;
  // The drop on a kick near the asked time.
  const dropBeat = Math.round(((opts.dropS ?? 32) - first) / period);
  const dropS = first + dropBeat * period;
  const samples = Math.floor(durationS * sr);
  const out = new Int16Array(samples);
  const kicksS: number[] = [];
  for (let b = 0; first + b * period < durationS; b += 1) {
    const t0 = first + b * period;
    kicksS.push(t0);
    const inBreak = b >= dropBeat - 8 && b < dropBeat;
    if (inBreak) continue;
    const start = Math.round(t0 * sr);
    for (let i = 0; i < Math.round(0.12 * sr) && start + i < samples; i += 1) {
      const t = i / sr;
      out[start + i] = Math.round(26000 * Math.exp(-t / 0.04) * Math.sin(2 * Math.PI * 55 * t));
    }
  }
  // A quiet low pad everywhere, so silence isn't the floor.
  for (let i = 0; i < samples; i += 1) out[i] = Math.max(-32768, Math.min(32767, out[i]! + Math.round(300 * Math.sin((2 * Math.PI * 40 * i) / sr))));
  return { pcm: new Uint8Array(out.buffer), kicksS, dropS, periodS: period };
}
