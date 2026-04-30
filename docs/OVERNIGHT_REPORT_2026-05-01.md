# Overnight Report - 2026-05-01

## PRs Merged

1. [#194 - creator: TikTok wizard polish - types regen + Markdown brief export](https://github.com/matas-offpixel/meta-campaign-builder/pull/194)
   - Regenerated Supabase types, tightened `tiktok_campaign_drafts` DB typing, and added Step 7 Markdown brief export.

2. [#195 - creator: TikTok wizard edge cases + validation surface](https://github.com/matas-offpixel/meta-campaign-builder/pull/195)
   - Added shared wizard validation and user-facing failure states across Steps 0-7.

3. [#196 - creator: canonical event-aware TikTok window for share reports](https://github.com/matas-offpixel/meta-campaign-builder/pull/196)
   - Added computed-first TikTok window resolution and aligned share reports plus cron windows.

4. [#197 - creator: Motion-replacement tag schema + seed import (migration 061)](https://github.com/matas-offpixel/meta-campaign-builder/pull/197)
   - Added Motion taxonomy foundation, `creative_tag_assignments`, `creative_scores`, seed importer, and mocked DB tests.

5. [#198 - creator: TikTok write API foundation + idempotency (migration 062, foundation only - no live writes)](https://github.com/matas-offpixel/meta-campaign-builder/pull/198)
   - Added disabled-flag write helpers, idempotency storage, launch orchestration, and mock-only tests. No route/UI wiring.

## Validation

- PR #194: focused brief tests, touched-file lint, `npx tsc --noEmit`, and local build/test checks passed. Repo-wide `npm run lint` still has unrelated pre-existing lint debt.
- PR #195: validation/review tests, touched-file lint, `npx tsc --noEmit`, and local build/test checks passed. Repo-wide `npm run lint` still has unrelated pre-existing lint debt.
- PR #196: TikTok window tests, touched-file lint, `npx tsc --noEmit`, and local tests passed.
- PR #197: `node --experimental-strip-types --test 'lib/db/__tests__/creative-tags.test.ts'`, touched-file lint, `npx tsc --noEmit`, and `npm test` passed.
- PR #198: `node --experimental-strip-types --test 'lib/tiktok/__tests__/write-foundation.test.ts'`, touched-file lint, `npx tsc --noEmit`, and `npm test` passed.
- GitHub/Vercel checks passed before each merge.

## Decisions Logged

Decisions were appended to `docs/TIKTOK_DECISIONS_FOR_MORNING_REVIEW.md` for PRs #194-#198, including:

- Preserving Google Ads RPC typings after Supabase type regeneration.
- Centralizing TikTok wizard validation.
- Keeping manual TikTok share-report imports visually authoritative while API windows become computed-first.
- Evolving the existing `creative_tags` table for Motion taxonomy rows.
- Keeping TikTok write helpers behind `OFFPIXEL_TIKTOK_WRITES_ENABLED === "true"` with no caller.

## Spec Questions

Existing open questions remain in `docs/SPEC_QUESTIONS_FOR_MATAS.md`. The ones that matter most after tonight:

1. Confirm when BB26-RIANBRAZIL can move from manual-preserved TikTok rendering to fully API-rendered breakdowns.
2. Confirm whether invalid TikTok video references should ever be allowed as draft placeholders.
3. Confirm the migrated Supabase project used for type generation includes `063_encrypt_google_ads_credentials.sql`.
4. Confirm the Motion taxonomy should coexist in `creative_tags` rather than split into a dedicated taxonomy table.

## Pending Cowork Migrations

Apply these manually via Cowork MCP, in order:

1. `supabase/migrations/061_creative_tags_schema.sql`
2. `supabase/migrations/062_tiktok_write_idempotency.sql`

Do not run either from Cursor. Neither was applied tonight.

## Critical Morning Checklist For Matas

1. Apply migration 061 and migration 062 via Cowork MCP.
2. Ensure `docs/motion-research/01-glossary-with-creative-ids.json` exists, then run `scripts/import-motion-tags.ts` to populate `creative_tags` from the Motion glossary.
3. Sanity-check the TikTok wizard with the brief export from Step 7.
4. Verify the edge-case validation surface across the TikTok wizard.
5. Test the canonical share-report TikTok window on Rian Brazil Promo.
6. Review PR #198's write API foundation. Decide whether to flip `OFFPIXEL_TIKTOK_WRITES_ENABLED=true` only for a sandbox advertiser before any production use.

## Smells / Watch Items

- `creative_tags` already existed for legacy intelligence tagging. PR #197 made taxonomy rows coexist in the same table; review this before applying migration 061.
- The referenced Motion glossary JSON was not present on `origin/main`; the importer fails clearly unless the file exists or `MOTION_GLOSSARY_PATH` is set.
- `gh pr merge --squash --delete-branch` merged remotely but failed local checkout cleanup because `main` is checked out in `/Users/liebus/mcb-tiktok-oauth`; I verified merged state and deleted remote branches manually.
- Repo-wide ESLint still has unrelated historical failures, so validation focused on touched files plus `tsc`/tests.
