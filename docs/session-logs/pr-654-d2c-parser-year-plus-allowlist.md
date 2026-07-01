# Session log

## PR

- **Number:** 654
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/654
- **Branch:** `d2c/parser-year-plus-allowlist`

## Summary

Live trial today (Jackies Mallorca, 2026-08-16) surfaced two D2C bugs: the
brief parser hallucinated 2025 for every extracted date, and Matas's approver
allowlist was empty so scheduled sends couldn't be approved on
`/d2c/event/[id]`. Fixes both: an explicit today's-date + future-bias system
prompt plus a deterministic post-parse year-rollforward guard for the parser,
and Matas's UUID added to `MATAS_USER_IDS`.

## Scope / files

- `lib/d2c/brief-parser/index.ts` — `buildSystemPrompt(todayIso)` injects
  today's date + a future-year rule; `applyYearInferenceGuard` rolls any
  extracted date more than 1 day in the past forward (year-by-year, capped)
  and logs `[d2c brief parser] year_rolled_forward`; `ParseBriefDeps.now`
  added for deterministic tests.
- `lib/d2c/brief-parser/__tests__/year-inference.test.ts` — 4 tests: prompt
  injection, explicit-future-year retained, implicit past year rolled
  forward (with schedule + warning assertions), and a 2-year-stale date
  rolling forward correctly.
- `lib/auth/operator-allowlist.ts` — `MATAS_USER_IDS` populated with
  `b3ee4e5c-44e6-4684-acf6-efefbecd5858`; typed `readonly string[]` rather
  than `as const` (a literal tuple type breaks `isD2CApprover`'s
  `.includes(userId: string)` call — confirmed via a standalone `tsc` repro).

## Validation

- [x] `npx tsc --noEmit` — clean (no errors in changed files, project-wide).
- [x] `npm run build` — succeeds.
- [x] `npm test` — 2403 tests, 2387 pass, 13 fail; the 13 failures are
      pre-existing on `main` (same count, unrelated module-alias resolution
      issues in dashboard/db test files) and reproduce identically on
      `main` before this branch's changes.
- [x] `npm run lint` — 115 problems (20 errors, 95 warnings), identical to the
      `main` baseline; none in the files this PR touches.

## Notes

- Live-trial context: Jackies Mallorca (event id `5a98dad4…`) was deleted
  post-diagnosis once the year bug was confirmed; the next brief-ingest trial
  will validate the fix end-to-end.
- No Ops-owned files touched (`CLAUDE.md`, `package.json`, `lib/types.ts`
  untouched); no new npm deps.
- No auto-merge — Matas merges after reading the diff.
