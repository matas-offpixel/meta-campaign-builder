# Session log — plans menu and width

## PR

- **Number:** 871
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/871
- **Branch:** `cursor/plans-menu-and-width`

## Summary

Three live click-through fixes from #870 at 1440×900: the /plans ⋯ menu stays open (portal + deferred outside-close), plan surfaces use a 1400px reading cap, and the row open control has an accessible name.

## Scope / files

- `components/viz/overflow-menu.tsx` — portal to `document.body`; defer outside pointer listener
- `lib/viz/overflow-menu.ts` — open-state item view + row/menu pointer isolation
- `components/library/library-rows.tsx` — named overlay open control; row vs ⋯ stopPropagation; horizontal row
- `lib/plan/surface.ts` — `PLAN_SURFACE_MAX_WIDTH_CLASS` = `max-w-[1400px]`
- `app/(dashboard)/plans/page.tsx` + `app/(dashboard)/plan/[id]/page.tsx` — plan-only width
- `components/dashboard/page-header.tsx` — optional `contentClassName`; default stays `max-w-6xl`

## Validation

- [x] Touched-file eslint clean
- [x] `npm run build` — pass (standalone `tsc` still has pre-existing jest noise)
- [x] `npm test` — 4706 / 4703 pass / 0 fail / 3 skipped
- [x] Falsify 1 and 3 against parent `67f9a4f`

## Notes

**Menu cause:** not row-click swallow (⋯ is a sibling) and not a missing controlled `open`. The menu was in-flow `absolute` under a 32px root, and the document `mousedown` closer subscribed in the same `open` effect turn. React 19 can flush that effect before the opening gesture finishes, so `event.target` is outside `rootRef` and `open` flips back to false — no items in the a11y tree, no dialog, no console error.

**Width:** not a shared page-body shell. Dashboard layout is unconstrained `flex-1 min-w-0`. The cap was local `max-w-6xl` on the two plan pages plus the shared PageHeader default. The ~810px crush was the left-stacked thumb/name/chips cluster. New cap `max-w-[1400px]` is set in `lib/plan/surface.ts` and applied only on /plans and /plan/[id] (header via optional override). Other dashboard pages stay `max-w-6xl`.

Parent sha: `67f9a4f`.
