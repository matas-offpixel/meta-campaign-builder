# MML M1 — the shell

## PR

- **Number:** 1043
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1043
- **Branch:** `cursor/mml-shell`

## Summary

PR M1 of 5 of `docs/session-logs/mml-multi-media-launcher-spec-2026-10-08.md`. Plans becomes MML (Multi Media Launcher). The data, launch path and Meta/TikTok/Google requests are unchanged, and there are no migrations. `/mml` and `/mml/[id]` replace `/plans` and `/plan/[id]`, which now 308 to the new routes with the query string kept. The canvas is one scrolling page of seven numbered sections. Today's zones were moved into them without changing their logic. The PR also fixes three layout bugs from Matas's screenshots: overlapping timeline labels, the right-aligned blocker column next to Launch, and the doubled `Plan campaign: Plan campaign:` prefix.

## Scope / files

- **Routes:** `app/(dashboard)/plans/page.tsx` → `app/(dashboard)/mml/page.tsx` and `app/(dashboard)/plan/[id]/page.tsx` → `app/(dashboard)/mml/[id]/page.tsx` (both `git mv`). `next.config.ts` `redirects()` serves `MML_LEGACY_REDIRECTS` from `lib/plan/mml-routes.ts`, which also holds `MML_LIST_PATH`, `mmlPlanHref`, `MML_NEW_HREF` and `mmlNavMatch`.
- **Nav:** `components/dashboard/dashboard-nav.tsx`. Plans is gone from the top section; MML is the first item under Platforms and matches `/mml`, `/mml/*`, `/plans` and `/plan/*`.
- **Links:**
  - `components/plan/{plan-link-banner,plan-delete-action,plan-workspace,meta-drawer,meta-drawer-details,tiktok-drawer-details,google-drawer-details}.tsx`
  - `components/library/plan-library.tsx`
  - the three wizard shells
  - `lib/plan/schedule.ts` (`planContinuationHref`)
  - The wizard shells and `plan-library.tsx` are read-only under the dashboard rules; only the link lines (and one comment) changed there.
- **Sections:**
  - `lib/plan/mml-sections.ts` holds the order, titles, placeholders, promoter rows and `channelDefaultsHref`.
  - `components/plan/mml-section.tsx` renders a section and its placeholder card.
  - `components/plan/mml-promoter-identity.tsx` renders the read-only promoter identity in ①.
  - `components/plan/plan-workspace.tsx` mounts them in this order: ① header, event, phase, promoter, window · ② placeholder + assets · ③ placeholder · ④ budget with target in an aside (or adjust / learn) · ⑤ placeholder · ⑥ channels · ⑦ launch.
  - On the client share view (`readOnly`), placeholders and section numbers are hidden.
- **⑥ Channels:** `components/plan/canvas-channels.tsx`. One card per channel with its state, blocker count, `Adjust` (opens the existing drawer, focus return kept) and a collapsible "what to fix" list.
- **⑦ Launch:**
  - `components/plan/canvas-launch.tsx` and `components/plan/blocker-items.tsx` (`PlanBlockerGroups`).
  - `lib/plan/launch-face.ts` (`launchBlockerGroups`: grouped by channel, repeats folded as `(×n)`).
  - `lib/plan/canvas.ts` (`Launch all (paused)`).
  - The `ENABLE_PLAN_FANOUT` gate and blockers are unchanged.
- **Timeline:**
  - `lib/viz/window-bar.ts`: labels are measured by their text (`estimateMomentLabelWidth`, `momentLabelBox`) instead of a fixed 56px box. Same-day joins win collisions (`keep`).
  - `components/viz/window-bar.tsx`: a hidden noun's tooltip sits beside its glyph, not in the label row.
- **Doubled prefix:** `lib/plan/preflight.ts` `scopedGoogleIssueMessage`. A Google message that already names its scope is not prefixed again.
- **Client card:** `components/dashboard/clients/channel-defaults-card.tsx` gets an `id="channel-defaults"` anchor for the ① link.
- **Docs:** `CLAUDE.md` routes and drawer tables.
- **Tests:**
  - New: `lib/plan/__tests__/mml-shell.test.ts` (redirects through Next's own matcher, nav match, section order and zone placement, launch grouping, timeline, prefix).
  - Route path strings updated in the existing plan/viz/db tests.
  - Five assertions updated because they pinned behaviour this PR changes: the launch label, the wizard `planHref`, the launch blocker wiring, the nav href, and the zone gutter test.

## Validation

- [x] `npx tsc --noEmit`: no new errors (the remaining errors are already on `main`).
- [x] `npx eslint` on touched files: no new problems (`window-bar.tsx:82` and the Google wizard shell error are already on `main`).
- [x] Node suite: 7200 tests, 7196 pass, 4 skipped, 0 fail (baseline 7177 / 7173 / 4 / 0).
- [x] Vitest: 8 / 8.
- [x] `next dev`: `curl` shows `/plans` → 308 `/mml`, `/plans?tab=templates` → 308 `/mml?tab=templates`, `/plan/p1?drawer=tt&tab=tt-video` → 308 `/mml/p1?drawer=tt&tab=tt-video`, `/plan/new?event=e1` → 308 `/mml/new?event=e1`, `/share/plan/tok` not redirected.
- [x] Signed-in desktop walk (1440px) of `/mml` and `/mml/7bd5619b…`: seven sections in order, three blocker groups under Launch, timeline labels no longer overlap.

## Notes

- `frames:check` will diff. The frame harness mounts the zones directly, so the channel cards, launch layout, label and timeline changes show up in the baselines. Refresh them from the Ubuntu CI artifact, as #918 did.
- ⑤ is a placeholder (M4). Until then, locations stay per channel through `Adjust`.
- ① shows raw IDs when a Page or IG account has no row in the BM sync tables, and always for TikTok identities, which have no name cache. That's the same fallback the header chips use. Names would need new platform reads, which are out of scope here.
- Kept as "plan": instance nouns ("New plan", "Delete plan") and the client-facing share page title.
