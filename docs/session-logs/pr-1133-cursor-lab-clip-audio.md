# Session log

## PR

- **Number:** 1133
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1133
- **Branch:** `cursor/lab-clip-audio`

## Summary

A sound control on the clip tile, the 9:16 render preview, and feed-post media. Every player mounts muted. Unmuting one mutes the others and leaves them playing; unmuting a paused player starts it. The tap does not select, open, or scrub. Nothing is stored. The control is hidden only when the clip row already records that the file has no audio.

## Scope / files

- `components/dashboard/events/creative-lab/use-clip-video.tsx` — audible state, direct `video.muted`, exclusive unmute
- `lib/creative-lab/clip-audio.ts` — the page bus, the hide rule, the action label
- `components/dashboard/events/creative-lab/clips.tsx` — the control on a tile that has a preview
- `components/dashboard/events/creative-lab/caption-overlay.tsx` — the control on a non-compact player
- `components/dashboard/events/creative-lab/captions.tsx` — feed posts pass the clip's audio flag
- `components/dashboard/events/creative-lab/audio-frame-mount.tsx` — CLA1 and CLA2
- `lib/db/creative-lab.ts` — optional `hasAudio` on the card clip
- `lib/creative-lab/__tests__/clip-audio.test.ts`

## Validation

- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [x] `npm test`
- [ ] `frames:check` — CLA1 and CLA2, plus any Lab or event-page frame the control moves

## Notes

Migration: none. Compact players (round-matrix cells, the crop strip, candidate tiles) do not get the control. Do not add the design-pass label.
