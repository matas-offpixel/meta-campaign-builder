# Session log — OP909 Admin Sprint 1: aesthetic pivot + Pages restructure

## PR

- **Number:** 686
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/686
- **Branch:** `cursor/admin-sprint-1-aesthetic-pivot`

## Summary

First (safest, highest-value) slice of the Sprint-1 architectural refactor:
the pure `/admin` aesthetic pivot to the fan-facing LP language (mono +
Futura Bold Italic, pure white, zero radius, 0.5px black hairlines) plus
Matas's core Pages-list UX asks. No migration; the fan-facing renderer is
untouched. Goals 5/6 (migration 139 + modules + LP renderer refactor) and
Goal 7 (tabbed editor) are deliberately split into follow-up PRs — a
live-data backfill migration and a locked-renderer refactor should not ride
inside a CSS pivot (repo PR mechanics: sequential merge).

## Scope / files (Goals 1, 2, 3, 4, 8, 9)

- `app/globals.css` — scoped `.op909-admin` design system: admin tokens
  (mono/Futura/white/hairline/accent), re-mapped shared semantic tokens
  (so legacy admin pages de-beige automatically via CSS-var cascade),
  scoped zero-radius. **Global `:root` beige theme untouched** → operator +
  share surfaces unaffected.
- `components/admin/ui/button.tsx` — AdminButton/AdminLinkButton (Goal 8):
  primary/secondary/ghost/destructive, mono lowercase, zero radius, optional
  accent fill for the single CTA.
- `components/admin/ui/section.tsx` — SectionHeader / Section / MetricGrid /
  MetricStat (Goals 2, 9): hairline sections + between-stat hairlines, no
  cards.
- `components/admin/admin-shell.tsx` — sidebar (Goal 3): OP909 accent
  box-logo + "for {client}" (no truncation), mono lowercase nav, accent
  left-border active state, ghost Log out, **"Powered by Off/Pixel"
  removed**.
- `components/admin/pages-list-row.tsx`, `copy-path-button.tsx`,
  `pages-list.tsx` — Pages restructure (Goal 4): 48px thumbnail (artwork →
  brand-accent box fallback), clickable Futura title, mono copy-path
  ("Copied" 2s), comma-sep metadata, 5 icon actions (edit/preview/copy/
  insights/delete), search + sort + hide-past toolbar, offset pagination.
- `app/admin/[clientSlug]/pages/page.tsx` — server page feeds the list +
  origin (from headers, for the copied absolute URL).
- `app/admin/[clientSlug]/page.tsx` — dashboard home pivoted to MetricStat
  grid + hairline rows.
- `app/admin/[clientSlug]/layout.tsx` — resolves client branding, passes
  accent to the shell.
- `lib/db/client-admin.ts` — `listClientPages` now carries artworkUrl +
  createdAt; new `getClientBranding` (reuses LP `resolveAccent`).
- `lib/admin/pages-list.ts` (+ tests) — pure filter/sort + copy-state seam.

## Resolved spec conflict

Goal 1 says "sidebar keeps its dark bg" but Goal 3 defines the active nav
item as BLACK text with hover = "text darken only" — only coherent on a
LIGHT sidebar. Shipped light (matches the all-white Supreme target; the
accent box-logo carries the colour). Flip to a dark rail later = one bg +
text-colour swap.

## Validation

- [x] `node --test lib/admin/__tests__/pages-list.test.ts` — 14/14
  (search, hide-past, all 4 sorts, null-sink, no-mutate, copy helpers)
- [x] `npx tsc --noEmit` clean; eslint clean; `npm run build` clean
- [x] Browser (live GMC, ephemeral magic-link session): Pages list +
  Dashboard home render exactly to spec — accent box-logo, no truncation,
  thumbnail, copy-path "Copied" transient confirmed, icon actions, metric
  stats as hairline blocks. Unauth `/pages` correctly 307s to
  `/admin/login`. (Hydration warning at pages-list.tsx:64 is the
  `data-cursor-ref` automation-tool artifact — attribute-level, input has
  no nondeterministic attrs.)

## Follow-ups (next PRs in this sprint)

- PR 2: migration 139 (modules/visibility/customisation + backfill) + pure
  module resolver + LP renderer refactor (read-time fallback → byte-identical).
- PR 3: tabbed editor + modules CRUD (drag reorder / enable / remove).
- Legacy admin pages (fans/insights/settings/integrations) inherit the
  white/hairline/zero-radius treatment via the token re-map, but still use
  their old card markup; full per-page restyle rides with Sprint 2.
