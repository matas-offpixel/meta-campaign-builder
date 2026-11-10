# Session log — artist card, variant A

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/artist-card-lab`

## Summary

The Lab artist card is variant A only. Matas paused cut-outs, so this build has no variant B and no "Waiting on the cut-out matte" state. A headliner whose photos all fail the gate sees each failed rule and one line pointing at the artist's Instagram. The claim slot is on the composition and empty. The claim words and the top/bottom gradient are the next PR.

## Scope / files

- `lib/creative-lab/artist-card.ts` — `layoutText` returns `claim`, `{ text: null }` unless a caller passes text. Nothing draws it.
- `lib/creative-lab/artist-card-lab.ts` — `planHeadlinerCard`. First photo that passes every rule and has no extension failure is variant A, with `photo extended top by {n} px` when it was extended. Otherwise `no-photo`. Does not import `artist-card-cutout`.
- `lib/creative-lab/artist-card-gate-copy.ts` — the Reeshy fixture the frame shows.
- `lib/creative-lab/psd-kit.ts` — `liveTextAccount` (one text layer, names and info runs, coral `#ff6876` on PART 1 / & / >, "no effects"). A smart object with no nested layers is one panel. The lockup stays one piece.
- `components/dashboard/events/creative-lab/photo-gate.tsx` — the no-photo state.
- `components/dashboard/events/creative-lab/artist-card-frame-mount.tsx` — ACG1.
- Frames: `ACG1-1280`, `ACG1-393`. AC1–AC3 are not reshot: Bootzy is not in the repo and the Drive photos are not fixtures. The slot test still asserts the lockup ink width at 302 px.

## Placeholder for design

Exact sentence on the no-photo state, to be replaced:

`PLACEHOLDER: a passing photo can come from @reeshy on Instagram.`

With no handle it reads `PLACEHOLDER: a passing photo can come from the artist's Instagram.`

## Validation

- [x] `node --conditions react-server --experimental-strip-types --test` on artist-card, artist-card-lab, psd-kit
- [ ] frames pair `only=ACG`
- [ ] CI on the frames commit

## Notes

- Migration: none.
- No design-pass label.
- H17 / O21 is not in this build. `chooseVariant` on main is unchanged and unused here.
- A photo that fails the extension colour test (Reeshy 17 37 02, drift 19.98) is a gate reason, not a cut-out.
