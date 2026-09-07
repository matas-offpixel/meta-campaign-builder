# Session log

## PR

- **Number:** 915
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/915
- **Branch:** `cursor/plan-new-picks-no-show`

## Summary

`new plan` no longer silently picks the soonest upcoming show. `preferredPlanEventId` returns the `?event=` deep link when it resolves, and `""` otherwise. The canvas that already existed for no show — header `new plan`, the picker as the only live control, not-yet zones that say `pick a show first`, Launch disabled with `pick a show to plan` — is now the landing state. A0 frames it.

`frames:check` no longer writes a missing baseline and calls that green. A missing PNG fails with `MISSING <id> — run frames-baselines.yml and commit docs/frames/<id>.png`. Ubuntu `A0.png` is committed from that workflow, not from macOS.

## Scope / files

- `lib/plan/event-picker.ts` — `defaultPlanEventId` → `preferredPlanEventId`; no first-of-list fallback
- `app/(dashboard)/plan/[id]/page.tsx` — `/plan/new` constructor
- `lib/plan/plan-name.ts` — unnamed header is `new plan`
- `lib/plan/canvas.ts` / `lib/plan/launch-face.ts` — `pick a show to plan` / `pick a show first`
- `components/plan/plan-no-show-lock.tsx` — Locked wrapper both surfaces call
- `components/plan/plan-workspace.tsx` / `components/plan/plan-frame-mount.tsx` — no-show face
- `scripts/plan-frames/{ids,types,builders,fixtures,run.mjs,baseline.mjs}` — A0; check mode fails a missing PNG
- Tests: event-picker, canvas, launch-face, plan-frames, plan-frames-baseline

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5379 pass, 4 skipped)
- [ ] CI `frames:check` red on missing A0, then green after Ubuntu `docs/frames/A0.png`

## Notes

`/plan/new?event=` still opens on that show (runbook Prydz link). `/plans` list copy, drawers, and the launch path are untouched. `ENABLE_PLAN_FANOUT` stays as production has it.
