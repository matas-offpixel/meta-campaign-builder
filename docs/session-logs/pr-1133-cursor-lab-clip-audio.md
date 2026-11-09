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
- [x] `npm run build`
- [x] `npm test`
- [ ] `frames:check` — CLA1 and CLA2, plus the Lab and event-page frames the control moves

## Notes

Migration: none. Compact players (round-matrix cells, the crop strip, candidate tiles) do not get the control. Do not add the design-pass label.

Verdict on 9247901: the tile and the behaviour pass. On the caption-overlay player the control moves into the transport row, after the scrubber (`placement="inline"`). The tile stays bottom-left.

Frames, Ubuntu, head fe11758. `only=CL` runs 42627372523 and 42627383283 (pair within 0.2%; CL5-1280 is 83 px, the rest 0). `only=IR` runs 42627393520 and 42627404229 (pair 0). Committed from the first of each pair.

- CLA1 and CLA2, both widths: new. Tiles with the first unmuted; a feed post and a render preview, each muted.
- CL3, CL4, CL5, CL6, CL7, CL9, CL10, both widths: the control on a tile or a preview.
- IR1-1280 and IR2-1280: the event page's tiles carry the control. At 393 those pages are clipped before the tiles.
