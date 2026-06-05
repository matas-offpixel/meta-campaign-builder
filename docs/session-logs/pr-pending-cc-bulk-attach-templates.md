# Session log — bulk-attach-templates

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cc/bulk-attach-templates`

## Summary

Adds reusable template save/load to the bulk-attach flow. Operators define a
named set of fuzzy match criteria (campaign name substrings, ad set name
substrings) once, then apply it to future events to pre-populate campaign and
ad-set selections without manual re-picking. Templates are cross-event and
user-scoped; drafts (PR #552) remain event-scoped in-progress saves.

Depends on PR #552 (bulk-attach-drafts) being merged first — both are now on main.

## Scope / files

- `supabase/migrations/114_bulk_attach_templates.sql` — table, trigger, RLS, indexes, increment RPC
- `lib/bulk-attach/template-matcher.ts` — pure matching functions (matchCampaigns, matchAdSets, helpers)
- `lib/db/bulk-attach-templates.ts` — server-side list/get/save/delete/incrementUseCount
- `app/api/bulk-attach-templates/route.ts` — GET (list) + POST (save/update)
- `app/api/bulk-attach-templates/[id]/route.ts` — GET (single) + DELETE
- `app/api/bulk-attach-templates/[id]/apply/route.ts` — POST: matches caller-supplied campaigns, increments use_count, returns adSetMatchPattern
- `components/bulk-attach/ad-set-picker.tsx` — new optional `adSetMatchPattern` prop: pattern-filtered pre-selection + "Template match" badge + unmatched-term warning
- `app/(dashboard)/events/[id]/bulk-attach/page.tsx` — "Save as template" form + "Load template" split-pane modal with match preview and Apply button; `adSetMatchPattern` threaded through to step 1
- `lib/bulk-attach/__tests__/template-matcher.test.ts` — 24 unit tests (all pass)

## Validation

- [x] `npx tsc --noEmit` — 0 new errors
- [x] `node --experimental-strip-types --test` — 24/24 pass
- [ ] Migration 114 applied to Supabase (prerequisite before merge)
- [ ] Manual RLS test: user A cannot read user B's template
- [ ] E2E: save template with campaign filter, navigate to new event, load template, verify campaigns pre-selected

## Notes

- `creative_config` is saved from `creatives[0]` fields but not auto-applied to the wizard in v1 — stored for future use.
- Templates do not auto-launch. Suggestions only.
- No global/team-shared templates in v1. User-scoped only.
- `use_count` incremented via `increment_bulk_attach_template_use_count` SQL function (atomic, avoids read-modify-write race).
