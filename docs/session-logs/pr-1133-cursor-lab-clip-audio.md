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
- [ ] `frames:check` — overlay sound moved into the transport row; CL7 and CL9 did not move

## Notes

Migration: none. Compact players (round-matrix cells, the crop strip, candidate tiles) do not get the control. Do not add the design-pass label.

Verdict on 9247901: the tile and the behaviour pass. On the caption-overlay player the control moves into the transport row, after the scrubber (`placement="inline"`). The tile stays bottom-left.

Frames, Ubuntu, head a059104. `only=CL` runs 42655047511 and 42655052572. `only=IR` runs 42655057607 and 42655062504. Committed from the first of each pair. Pixelmatch threshold 0.1.

| Frame | Pair px | Pair ratio | Git px |
| --- | --- | --- | --- |
| CLA1-1280 | 0 | 0 | 673 |
| CLA1-393 | 0 | 0 | 1579 |
| CLA2-1280 | 0 | 0 | 1915 |
| CLA2-393 | 0 | 0 | 3251 |
| CL3-1280 | 0 | 0 | 1194 |
| CL3-393 | 0 | 0 | 1312 |
| CL4-1280 | 0 | 0 | 1194 |
| CL4-393 | 0 | 0 | 1312 |
| CL5-1280 | 83 | 0.000017 | 2392 |
| CL5-393 | 0 | 0 | 1312 |
| CL6-1280 | 0 | 0 | 2392 |
| CL6-393 | 0 | 0 | 1312 |
| CL10-1280 | 0 | 0 | 1860 |
| CL10-393 | 0 | 0 | 2632 |
| IR1-1280 | 0 | 0 | 1194 |
| IR2-1280 | 0 | 0 | 1194 |

CL7-1280, CL7-393, CL9-1280, CL9-393: pair 0, git 0. Left.

Verdict reshoot, what moved: on every caption-overlay player the sound control leaves the corner (it was covering Play) and sits at the right end of the row, ▶ · scrubber · sound. Tiles stay bottom-left.

- CLA1, both widths: the render preview under the tiles. The four tiles do not move.
- CLA2, both widths: the feed post and the render preview.
- CL3, CL4, CL5, CL6, CL10, both widths: the preview player.
- IR1-1280 and IR2-1280: the event page's preview player.
- CL7 and CL9, both widths: unchanged.

First shoot, head fe11758. `only=CL` runs 42627372523 and 42627383283. `only=IR` runs 42627393520 and 42627404229. That pass added the control. CL7 and CL9 moved then and not on this reshoot.
