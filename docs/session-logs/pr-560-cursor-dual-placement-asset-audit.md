# Session log — cursor/dual-placement-asset-audit

## PR

- **Number:** 560
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/560
- **Branch:** `cursor/dual-placement-asset-audit`

## Summary

Stage A audit (no code changes) of the silent dual-asset placement bug: a 4:5
Feed asset renders across all placements (including 9:16 Reels) instead of the
dedicated 9:16 asset. Single Markdown deliverable
`docs/AUDIT_DUAL_PLACEMENT_ASSET_2026-06-05.md`.

Root cause confirmed: both launch paths (bulk-attach + standalone wizard) share
`buildCreativePayload`, which collapses a multi-aspect-ratio creative to a single
asset via hard-coded priority (`HASH_PRIORITY` / `VIDEO_PRIORITY`) and never
emits `asset_feed_spec` / `asset_customization_rules`. The strict-mode sanitizer
suspicion is a red herring (bulk-attach never runs it; builders never produce an
`asset_feed_spec` to strip).

## Scope / files

- `docs/AUDIT_DUAL_PLACEMENT_ASSET_2026-06-05.md` — audit deliverable (new)
- Read-only trace: `lib/meta/creative.ts`, `app/api/meta/bulk-attach-ads/route.ts`,
  `app/api/meta/launch-campaign/route.ts`, `lib/bulk-attach/draft-state.ts`,
  `lib/types.ts`
- Supabase queries against `bulk_attach_drafts` + `campaign_drafts` to confirm
  both ratios upload with valid IDs

## Validation

- [x] No code changes (audit only)
- [x] Repo-wide search: `asset_customization_rules` / `customization_spec` = 0 matches
- [x] DB confirms dual-asset drafts carry both 4:5 and 9:16 with valid videoId/assetHash

## Notes

- Draft PR — for tomorrow morning's review before Stage B (the fix) is scoped
  into a separate PR.
- The specific Innervisions/`Plans_Feed.png` draft was already launched and is no
  longer in `bulk_attach_drafts`; representative dual-asset drafts prove the
  identical code path.
