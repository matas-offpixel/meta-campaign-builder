# Session log

## PR

- **Number:** 1114
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1114
- **Branch:** `cursor/asset-bank-m6a`

## Summary

Creative Lab M6-A: a release has a state, the claim ladder says what that state allows, and a proposal waits for Approve. `events.presale_at` and `events.general_sale_at` are derived from the release rows. Migration 211 is written and not applied. The vendor reader is not in this PR.

## Scope / files

- `supabase/migrations/211_creative_lab_m6a.sql`
- `lib/releases/`, `lib/ticket-warnings/next-rung.ts`, `lib/db/releases.ts`
- `lib/creative-lab/caption-facts.ts` (A11)
- `components/dashboard/asset-bank/`, event page, client Ticketing tab, Today
- `app/api/events/[id]/releases/route.ts`
- AB1–AB5 frames, CL9 crop button width
- `docs/creative-lab/design-rules.md`

## Validation

- [x] `npm test`
- [x] `npm run build`
- [x] frames baselines committed (AB1–AB5, CL9-1280). design-pass stays red until the label.

## Notes

Nothing was written to production. The backfill runs only when Matas applies 211. A count writes `tier_channel_sales` only when a capacity is known and a channel named `manual` already exists.
