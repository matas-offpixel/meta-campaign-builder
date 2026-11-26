/**
 * CT4: where a press (or a drag) on the Snippet tab's waveform lands, in
 * seconds: the press's x across the waveform's box, as a share of the
 * track's length, kept inside the track. On the one-window view a press
 * places the drop marker there and saves it through edit { kind: "drop" },
 * the same as releasing a drag (components/dashboard/events/creative-lab/snippet.tsx),
 * including on a file with no drop yet (NO_CLEAR_DROP).
 *
 * Pure. Relative imports only (node:test).
 */
export function pressSeconds(clientX: number, box: { left: number; width: number } | null | undefined, durationS: number): number {
  if (!box || !(box.width > 0) || !(durationS > 0)) return 0;
  return Math.min(durationS, Math.max(0, ((clientX - box.left) / box.width) * durationS));
}
