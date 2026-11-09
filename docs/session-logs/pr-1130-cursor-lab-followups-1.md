## PR

- **Number:** 1130
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1130
- **Branch:** `cursor/lab-followups-1`

## Summary

The border reset moves into `@layer base`, so a `border-{colour}` utility paints again, and the one-off `.border-on-media` rule is gone. Each selected, before a write, counts How many × the selected clips and says "Write to see these on the clips."

## Scope / files

- `app/globals.css`
- `components/dashboard/events/creative-lab/captions.tsx`
- `lib/creative-lab/selection.ts`
- `lib/creative-lab/__tests__/selection.test.ts`

## Validation

- [x] `npm test`
- [x] `npm run build`
- [x] `frames:check`

## Notes

Migration: none. The tick's white stays `--on-media`. Before a write the line is what Write will make (`3 captions × 4 clips = 12 previews` at the default). After a write it counts the captions that write returned. No clips selected still uses "No clip selected — select clips to see the captions on them."

Frames, Ubuntu, head `e606c8c30303a682c3174c6f2713ba98b5550723`. `only=CL` runs 42617881078 and 42617885179. `only=IR` runs 42617889485 and 42617893026. `only=AB` runs 42617896855 and 42617900755. Each pair is 0 px apart. Committed from the first run of each pair. A colour utility now paints, where the unlayered reset had forced every border to the faint ink.

- CL2, CL3, CL4, CL7, CL8, both widths; CLV3-1280: an ink border (a rights chip, a selected control) that was the faint reset.
- CL5, CL6, both widths; CLS3-1280: the round's on cells draw an ink border.
- CL9, both widths: the crop picker and the ink border on the open clip.
- CL10, both widths: render-row borders.
- CLS1, both widths: a can't-run tile's dashed border is brick.
- CLQ1-1280, CLQ2 both widths, CLQ3 both widths; CLV1-1280, CLV2-1280, CLV4 both widths: an olive rights or voice chip.
- IR1-1280, IR2-1280, IR2-393, IR7-393: the event card's ink borders.
- IR3-1280, IR4-1280, IR4-393, IR6-1280, IR8-1280, IR8-393: a rail or canvas chip.
- AB1-1280, AB2 both widths, AB3 both widths, AB4 both widths, AB5 both widths: a proposed, approved or warning chip paints ochre, olive or brick.

Left, because they matched git: CL1 both widths, CLS2 both widths, CLS3-393, CLS4 both widths, CLQ1-393, CLQ4 both widths, CLV1-393, CLV2-393, IR5 both widths, AB1-393.

Verdict on e109d77: an On cell is `border-border`, a Kept chip is `border-border-strong`, Untested and New are dashed `border-border-strong`, and the plan column is dashed `border-border`. Holding stays ink. CLS2b is Each selected before a write.

Verdict frames, Ubuntu, head `1ad7c8e35f1e052c1c02e06bee93687cda566a18`. `only=CL` runs 42623514410 and 42623519018. `only=IR` runs 42623523159 and 42623527202. Each pair is 0 px apart. Committed from the first run of each pair.

- CL5-1280, CLS3-1280: an On cell's border is the faint border, not ink.
- CL6-1280: the On cells, plus a Kept chip in border-strong and the plan column dashed in the faint border.
- CL6-393: the Kept chip and the plan column. The matrix table is hidden at 393, so the On cells do not move.
- CL3, CL4, CL10, both widths; CL5-393, CL7, CL9, both widths; CLS1, both widths; IR1-1280, IR2-1280: an Untested or New chip is dashed border-strong.
- CLS2b-1280, CLS2b-393: new. Each selected before a write, 4 clips, "3 captions × 4 clips = 12 previews", "Write to see these on the clips."

Left, because they matched this head: CL1, CL2, CL8, CLQ, CLV, CLS2, CLS3-393, CLS4, and the other IR frames.
