# Session log — visual language pass

## PR

- **Number:** 865
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/865
- **Branch:** `cursor/visual-language-pass`

## Summary

Standing design rule: minimum text, maximum visual cues. Shared primitives
live in `components/viz/` so every future surface inherits the same language.
Recurring explainer sentences become ⓘ tooltips; words stay only where they
carry unique information (names, numbers, errors). Presentation-only — no
data-shape, launch-path, gate, or schema changes. Event thumbs reuse existing
cached/storage sources only (no new Meta thumbnail fetches).

## Scope / files

### Primitives (`components/viz/` + `lib/viz/`)

- `PlatformGlyph` — Meta / TikTok / Google marks, sized variants
- `StatusDot` + `StatusStrip` — semantic states as colour dots; three-platform strip
- `MetricChip` + `AspectChip` — icon + value; aspect as a shaped outline
- `BlockerBadge` — amber count; expands to icon + ≤5-word label + jump arrow
- `ThresholdBand` — scale-up → maintain → reduce → pause zones + current marker
- `ActionGlyph` — scale-up ▲ / reduce ▼ / maintain — / pause ⏸
- `EventThumb` — existing artwork sources + initials fallback
- `PipelineStepper` — Meta → Derive → Assets → Launch
- `InfoTip` — furniture demotion
- `lib/plan/event-artwork-load.ts` — `page_events` hero/content + `d2c_event_copy.artwork_url`

### Surfaces in this PR

- `/plans` list — EventThumb, name, StatusStrip, £/day + date chips; delete stays ghost
- `/plan/[id]` — PipelineStepper; adapter cards shrink to glyph + chips + BlockerBadge + one action; furniture → ⓘ; ACTIVE/PAUSED as icon-chip pair
- Asset matrix — thumbs, AspectChip, switch + platform glyph (checkbox stays in DOM for grep-guard)
- Decisions list (#857/#864) — channel glyph, ActionGlyph, CPR + delta chip, small ThresholdBand, timestamp; dry-run = outline, applied = filled; `metric_unavailable` = dashed glyph + tooltip
- Step 2 summary + Review — ThresholdBand replaces the prose rule list

### Follow-up (not in this PR)

Per-event funnel card (A.1/A.2): visual funnel with proportional bars,
conversion % on the joins, per-platform colour split on reach/clicks,
provenance as tiny badges. Deferred so this PR stays presentation-sized.

## Word-count — `/plan/[id]` (source heuristic, not rendered DOM)

Standing furniture that rendered on every visit (~1,030 characters) moved
into ⓘ tooltips:

- PageHeader blurb (“Shared inputs, three adapter previews…”)
- Step 1 authoring-surface paragraph
- Step 2 “same Optimisation Strategy…” paragraph
- Asset-routing explainer
- “Launch status” heading + WIZARD_ACTIVE_VS_PLAN_PAUSED sentence

JSX `>text<` nodes on workspace + matrix + page: **1,304 → 1,148** characters
(under-counts multiline paragraphs). Unique info (names, numbers, action
verbs, errors, “Nothing prepared yet”, “Continue in wizard”, Ads Manager
link, Migration 157 empty-state) remains reachable — grep-guards still pin
those strings.

## Validation

- [x] `npx eslint` on touched viz / plan / decisions / wizard-summary files — clean
- [x] `npm run build` — compiled successfully (pre-existing remotion `config` warning)
- [x] `npm test` — 4642 tests, 1168 suites; 4639 pass, 0 fail, 3 skipped
- [x] Falsified against parent sha `75fb67f`: `lib/viz/tokens.ts` and
      `components/viz/` are absent (`git show` / `git ls-tree` fail)

## Notes

- Honest empty states stay (icon + short line). Blocker full messages +
  `issue.href` remain on the expanded badge.
- Dots and glyphs carry `aria-label`s with the words they replaced.
- Funnel visual pass is the immediate follow-up, not rushed here.
