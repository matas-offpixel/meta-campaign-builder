# Session log template

## PR

- **Number:** 766
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/766
- **Branch:** `cursor/repair-thumbnails-user-token`

## Summary

Task #128 continued: the repair script's first real `--live` run failed **all 42** write targets with Meta error code=3 "Application does not have the capability to make this API call" on `POST /adimages`. Root cause: `scripts/repair-video-thumbnails.mjs` used `META_ACCESS_TOKEN` (the system app token — an app still in App Review, task #90) for every Graph API call, including writes. The wizard's own launch path never hits this: every write in `app/api/meta/launch-campaign/route.ts` resolves the operator's personal Facebook OAuth token from Supabase `user_facebook_tokens` first (`resolveServerMetaToken` in `lib/meta/server-token.ts`) and only falls back to the env token as a last resort. Fixed by giving the script a separate, higher-priority token specifically for writes: `--token=<override>` CLI arg > freshest `user_facebook_tokens.provider_token` row (single-operator setup — no per-user filter needed) > `META_ACCESS_TOKEN` env fallback. Discovery reads are untouched (Meta only gates write capabilities during App Review, so reads succeed on either token). If the write token still falls all the way through to `env` and `--live` is set, the script now warns and requires an explicit `y` to proceed. The repair loop also specifically detects a code=3 failure and prints a remediation hint.

## Scope / files

- `lib/meta/repair-write-token.ts` (new) — canonical, unit-tested `resolveWriteToken` / `describeWriteTokenSource` / `isMetaMissingCapabilityError` / `MISSING_CAPABILITY_HINT`, dependency-injected against a minimal `SupabaseLike` interface (mirrors the exact `.from().select().not().order().limit().maybeSingle()` chain) so it doesn't need the full `@supabase/supabase-js` client type to test.
- `lib/meta/__tests__/repair-write-token.test.ts` (new) — 19 tests covering override precedence, DB-row resolution, DB error/empty/null-token fallback to env, DB exception fallback, the "no token anywhere" throw, all four `describeWriteTokenSource` formats, and `isMetaMissingCapabilityError` classification (duck-typed `.code`, `(#3)` message marker, capability wording, and negatives).
- `scripts/repair-video-thumbnails.mjs` — mirrors the above inline (same convention as the existing `isMetaPlaceholderThumbnailUrl`/`isMetaPlaceholderThumbnailImage` mirrors): new `--token=<override>` CLI arg; `resolveWriteToken`/`describeWriteTokenSource`/`isMetaMissingCapabilityError`/`MISSING_CAPABILITY_HINT`/`promptYesNo` helpers; startup log line (`write-token source=...`); a live-mode confirm-or-abort gate when the resolved source is `env`; `uploadImageFromUrl` and `patchCreativeImageHash` now take an explicit `writeToken` parameter instead of closing over `metaToken`, and their failures are thrown via a new `throwMetaWriteError` helper that attaches `.code`/`.subcode` so the repair loop can classify them; the repair loop's failure branch now prints `MISSING_CAPABILITY_HINT` when `isMetaMissingCapabilityError` matches. Discovery reads (`fetchCampaignAds`, `resolveImageHashMetadata`, `fetchCurrentPicture`, `fetchCurrentObjectStorySpec`, etc.) are unchanged and still use `metaToken`.

## Validation

- [x] `npx tsc --noEmit` (no new errors vs. baseline — same 447-line baseline error output on `main`, none in the new/changed files)
- [x] `npm run build`
- [x] `npm test` — 3701 tests / 3685 pass / 13 fail; true baseline (`git stash -u` on `main`) is 3682/3666/13 fail — same 13 pre-existing failures, our 19 new tests all pass, zero regressions
- [x] `eslint` — same 272 problems as baseline `main`, none in the new/changed files
- [x] Manual smoke tests of the script's `main()` flow: (1) dry-run with a network-unreachable Supabase mock falls back to `source=env` and logs correctly (regression: dry-run still works on the env token alone); (2) `--live` with an env-sourced write token shows the warning and aborts cleanly on `n` without making any Meta calls; (3) `--live` with stdin resumed to answer the prompt confirms the gate only activates when `source === "env"`

## Notes

- The DB query intentionally has no `userId`/`eq()` filter — this is a single-operator admin script (Matas), not a per-request web handler, so it just takes the freshest non-null `provider_token` row ordered by `expires_at desc`. `lib/meta/server-token.ts`'s `resolveServerMetaToken` (the per-request web path) is untouched and still filters by `userId`.
- `--token=<override>` bypasses the Supabase lookup entirely — useful for one-off testing without needing a fresh `user_facebook_tokens` row, and takes priority even over a valid DB row.
- Follow-up idea (not in scope here): the "operator must have a fresh Facebook connection" requirement means this script will fail the same way again if Matas's `user_facebook_tokens` row expires before a future repair run — the startup log line surfaces `expires_at` specifically so that's visible before wasting a full discovery pass.
