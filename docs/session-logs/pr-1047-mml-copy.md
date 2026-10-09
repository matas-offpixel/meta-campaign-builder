# Session log

## PR

- **Number:** 1047
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1047
- **Branch:** `cursor/mml-copy`

## Summary

MML section ③ replaces the placeholder. Suggest fetches a ticket URL (or uses the event row when the fetch fails) and asks Claude Haiku 4.5 for copy. A fact check drops any line that states a number, price, date, venue or artist the page and the event row do not contain. Apply writes the ticked lines onto MML-owned creatives and seeds the linked Google Search plan.

## Scope / files

- `lib/plan/copy-fetch.ts`, `copy-scrape.ts`, `copy-facts.ts`, `copy-limits.ts`, `copy-suggest.ts`, `copy-apply.ts`, `copy-server.ts`
- `app/api/plan/[id]/copy/route.ts`, `components/plan/mml-copy.tsx`
- `supabase/migrations/194_mml_copy.sql` — unapplied. Owner-only RLS. Page text capped at 8000 characters.
- No changes to `lib/meta/**`, `lib/tiktok/write/**`, `lib/google-ads/campaign-writer.ts`, `lib/plan/orchestrator.ts`, or `/api/plan/launch`.

## Validation

- [x] `node --conditions react-server --experimental-strip-types --test lib/plan/__tests__/copy.test.ts` — 16 pass
- [x] `lib/plan/__tests__/mml-shell.test.ts`, `canvas.test.ts`, `drawer.test.ts` — pass
- [ ] `npm test` (full suite, CI)
- [ ] Browser: paste a ticket URL on a real plan. Not exercised here (no signed-in session).

## Notes

Model: `claude-haiku-4-5`, named `MML_COPY_MODEL` in `lib/plan/copy-suggest.ts`. Same model string as `MODEL` in `lib/clients/asset-queue/copy-generator.ts`. Key: `ANTHROPIC_API_KEY`.

The Editor-template proof is not this PR. Migration 194 is in the PR body and is not applied.

A paused YouTube campaign with no daily is a separate PR (#1045).
