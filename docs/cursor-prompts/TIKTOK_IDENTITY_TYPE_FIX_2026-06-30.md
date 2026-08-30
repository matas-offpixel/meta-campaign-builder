# TikTok identity_type enum bug + wizard testability

**Tag:** `[Cursor, Sonnet]`
**Branch:** `cursor/creator/tiktok-identity-type-enum-fix`
**Scope target:** ~2-4 files, single PR
**Prereq:** none

## Why this PR

Matas tried to test the TikTok Campaign Creator wizard tonight (2026-06-30) on Ironworks (advertiser `7639802149165301776`). The Account Setup step's identity dropdown shows this error:

> *"TikTok identity API returned: identity_type: value is not one of the allowed values, value is PERSONAL_HUB, correct is AUTH_CODE, BC_AUTH_TT, CUSTOMIZED_USER, TT_USER. Use manual override below."*

`PERSONAL_HUB` is hardcoded in `lib/tiktok/identity.ts` as a valid identity_type but the TikTok API rejects it. Since it's the **first** entry in the iteration array, the whole identity fetch fails and the dropdown is empty for every advertiser.

The manual override field works (deliberately built as an escape hatch) but the wizard's primary path is broken for every TikTok client: Ironworks, Junction 2, Black Butter. Worth fixing properly.

## Repo state — verified tonight via grep

```
lib/tiktok/identity.ts:3:  export type TikTokIdentityType = "PERSONAL_HUB" | "CUSTOMIZED_USER" | "TT_USER";
lib/tiktok/identity.ts:8:  identity_type: TikTokIdentityType;
lib/tiktok/identity.ts:27:  "PERSONAL_HUB",      ← THIS is what's failing
lib/tiktok/identity.ts:45:    identity_type: identityType,
lib/tiktok/identity.ts:59:    identity_type: identityType,
```

The valid enum per the error message: `AUTH_CODE | BC_AUTH_TT | CUSTOMIZED_USER | TT_USER`.

## Paste this into Cursor (Sonnet)

```
GOAL
Fix the TikTok identity_type enum bug that's blocking the TikTok Campaign Creator wizard's Account Setup step. The error message from TikTok's API explicitly lists the valid identity_type values, so this is a deterministic enum-correction fix, not a research task. Single PR, ~2-4 files.

GROUNDING (DO NOT INVENT — VERIFIED 2026-06-30)
- File: lib/tiktok/identity.ts
- Current type union (line 3): "PERSONAL_HUB" | "CUSTOMIZED_USER" | "TT_USER"
- Current iteration array (line 27): includes "PERSONAL_HUB" as the first entry
- TikTok API's rejection message: identity_type allowed values are AUTH_CODE, BC_AUTH_TT, CUSTOMIZED_USER, TT_USER.
- Failure mode: the iteration calls TikTok's identity endpoint once per identity_type. Because PERSONAL_HUB is first AND invalid, TikTok 400s the whole call before subsequent valid types are tried.
- Wizard surface: app/(dashboard)/clients/[id]/tiktok-campaign-creator/* (or similar — grep for "TikTok Campaign Creator" string in the dashboard).
- The wizard has a "Manual identity override" field deliberately wired in as an escape hatch (the error message itself directs the user to it). Do NOT remove the manual override — it's a legitimate fallback.
- Affected advertisers (regression test against these): Ironworks 7639802149165301776, Junction 2, Black Butter (find their TikTok advertiser IDs in tiktok_accounts table if needed).

WHAT TO BUILD

1. lib/tiktok/identity.ts
   - Update the TikTokIdentityType union to: "AUTH_CODE" | "BC_AUTH_TT" | "CUSTOMIZED_USER" | "TT_USER".
   - Remove "PERSONAL_HUB" entirely.
   - Update the iteration array to: ["AUTH_CODE", "BC_AUTH_TT", "CUSTOMIZED_USER", "TT_USER"].
   - Order matters for failure surfacing: put BC_AUTH_TT first (most common — Business Center linked identities, which is what Off Pixel uses for all clients), then AUTH_CODE, CUSTOMIZED_USER, TT_USER as fallbacks.
   - If the iteration short-circuits on first success (likely — read the code to confirm), the order means BC_AUTH_TT is tried first → fastest happy path for the agency's actual setup.

2. Audit all OTHER references to PERSONAL_HUB across the repo. Grep:
   - lib/tiktok/*
   - app/api/tiktok/*
   - supabase/migrations/*.sql (in case a CHECK constraint hardcodes it)
   - lib/tiktok/share-render.ts uses identity_type but reads it as a string from DB, not the enum — likely no change needed, but confirm.
   If PERSONAL_HUB appears anywhere else, update consistently. If a migration has a CHECK constraint, claim the next free migration integer (likely 127 — verify with `ls supabase/migrations/ | tail -1`) and add an ALTER constraint migration. Apply via mcp__supabase__apply_migration (memory: feedback_migration_workflow_discipline).

3. Add a single test in lib/tiktok/__tests__/identity.test.ts (NEW or extend):
   - Asserts the TikTokIdentityType union contains exactly the 4 valid values.
   - Asserts the iteration array contains exactly those 4 values, in the documented order.
   - This is a regression guard — if anyone re-adds PERSONAL_HUB later, the test catches it.

4. Manual identity override: DO NOT touch the manual override UI or its backing route. It's a working escape hatch and must remain available — even after this fix, some advertisers may still need it because TikTok's identity API has additional account-specific gotchas (see memory project_tiktok_advertiser_id_default_trap if it exists, plus the BC-vs-personal split).

CONSTRAINTS — STRICT
- DO NOT touch the TikTok write API path (OFFPIXEL_TIKTOK_WRITES_ENABLED stays off; this PR is wizard-side only, the Account Setup step).
- DO NOT change the wizard's auth or RLS. Identity fetching is server-side via the existing TikTok token resolver.
- DO NOT add error swallowing. If all 4 identity_types fail, surface the error to the UI clearly so the user knows to use the manual override.
- DO NOT remove or weaken the manual identity override UI.
- DO NOT add a migration if no DB CHECK constraint actually exists. Verify first.
- Branch naming: cursor/creator/tiktok-identity-type-enum-fix per CLAUDE.md.

VALIDATION GATE
- npm run build: exit 0.
- npm run lint: clean on touched files.
- node --test lib/tiktok/__tests__/identity.test.ts: passes.
- Manual smoke test instructions in PR description (since the wizard requires auth + a TikTok advertiser):
  1. Local: log in as Matas, navigate to TikTok Campaign Creator for any of Ironworks / J2 / BB.
  2. Pick the corresponding TikTok advertiser from the dropdown.
  3. Expected behaviour: TikTok identity dropdown populates with the BC-linked identity (or whatever's actually attached to that advertiser), NOT empty + NOT showing the PERSONAL_HUB error.
  4. Manual identity override field still visible and functional as a fallback.

PR DESCRIPTION MUST INCLUDE
- Grep output showing PERSONAL_HUB before and after the change (proves the cleanup).
- Result of the manual smoke test for at least 2 advertisers (Ironworks + one other).
- Confirmation that the manual override is untouched.
- Confirmation that no migration was needed (or migration name claimed if a CHECK constraint existed).

ASK BEFORE DOING IF
- A CHECK constraint on identity_type does exist in a migration — surface it before adding the new migration. The constraint may need to be relaxed first or aligned differently.
- The iteration in identity.ts is not a simple array loop but a more complex stage-based fetch with side effects — surface the actual control flow, don't silently restructure.
- AUTH_CODE turns out to need additional auth-flow plumbing (it usually does — see TikTok docs) — if so, INCLUDE the enum value in the type but mark it as a future-implementation TODO with a clear comment, and de-prioritise it in the iteration order so BC_AUTH_TT and TT_USER cover the happy paths.

OUT OF SCOPE — DO NOT BUILD HERE
- TikTok write API enablement (separate Meta-side approval gate).
- Wizard UX redesign.
- Other wizard step bugs (Campaign Setup, Audiences, etc.) unless they share root cause with the identity_type enum.
- Any change to the Spark Ad OEmbed thumbnail workaround.
- Anything in the Meta wizard, Remotion, Mailchimp, or cron paths.
```

## After Cursor opens the PR

1. Cross-check the diff is small (~2-4 files), no unrelated changes.
2. Verify the PR description shows manual smoke test results on at least Ironworks.
3. Squash-merge.
4. Matas re-tests the Ironworks wizard step on Production after the deploy lands. Confirm identity dropdown populates without needing manual override (though the override stays available).

## Why this is `cc/`-shaped not `cursor/`-shaped

Honestly, this could be a Claude Code single-file PR. The bug is mechanical, the fix is deterministic, the scope is 1-2 files. **If you're picking up tomorrow and want minimum credit burn, ship this as Claude Code on `cc/creator/tiktok-identity-type-enum-fix` instead.** Cursor Sonnet is fine for this prompt but the cost-per-PR memory says Claude Code wins for single-file deterministic fixes.

Either way the work is the same; only the branch prefix changes.
