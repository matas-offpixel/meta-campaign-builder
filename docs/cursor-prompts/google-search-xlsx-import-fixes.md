# Cursor prompt [Cursor, Opus] — fix Google Search xlsx import: RSAs, negatives, daily budgets

Copy this entire block into Cursor as a single message. Opus — three real parser bugs found testing against the actual J2 Melodic xlsx; diagnosis is precise below.

PREREQUISITE: Phases 1-4 + 3.5 merged. Migration 096 applied.

---

## CONTEXT

Tested the xlsx import against the real `J2_Melodic_Google_Search_Ad_Plan.xlsx` on the LWE account. Three failures, all in `lib/google-search/xlsx-import.ts` (the parser) + one wizard budget-field issue. Diagnosis below is precise — these are confirmed root causes from reading the actual sheet structure, not guesses.

## BUG 1 — RSAs don't import (every ad group shows "0 RSAs", Review blocks with 11 "no RSA copy" hard errors)

**Root cause:** `applyAdCopy` uses `recordsFromRawRowsWithHeaderScan(rawRows(sheet), ["campaign", "type"])` and then reads `cell(idx.campaign)` per row. But in the real Ad Copy tab, the `Campaign` column is BLANK on every H1/D1 data row. The campaign name only appears in full-width SECTION HEADER rows like `C1 – BRAND: JUNCTION 2`, `C2 – ARTIST: ADAM BEYER` (these are styled banner rows where the campaign name sits in the first/Type-area cell, not the Campaign column). So `campaignName` is empty on every actual H/D row → the `if (!campaignName || !typeRaw || !content) continue` skips all of them → 0 RSAs.

Additionally, each campaign appears TWICE in the Ad Copy tab — once as a section header above its H1..Hn block, then AGAIN as a section header above its D1..Dn block (see the real sheet: "C1 – BRAND: JUNCTION 2" appears at row 4 for headlines and row 20 for descriptions).

**Fix:** rewrite `applyAdCopy` to CARRY FORWARD the current campaign from section-header rows:
- Iterate the raw rows (not the header-scanned records — you need the section banners).
- A row is a SECTION HEADER if its first non-empty cell matches a campaign-name pattern (e.g. starts with `C\d+` and/or matches one of the known campaign names from the skeleton, case-insensitive, ignoring the `–`/`-` and trailing descriptors). When you hit a section header, set `currentCampaign` to the matched skeleton campaign.
- A row is a DATA row if its Type cell matches `H\d+` or `D\d+` and it has content. Attach to `currentCampaign`.
- Match section-header text to skeleton campaigns flexibly: the header "C1 – BRAND: JUNCTION 2" should map to the skeleton campaign whose Keywords-tab name is "C1 – Brand: Junction 2". Normalise both (strip case, collapse whitespace, normalise dashes) and match. If the Ad Copy campaign label and the Keywords campaign label differ only in case/dash-style, they must still match. If they genuinely differ, fall back to matching on the `C\d+` prefix.

This is the classic merged-section-header xlsx pattern. The headlines block and descriptions block for the same campaign must accumulate into the SAME RSA (one RSA per campaign, attached to all its ad groups, as the current code already does once the campaign is correctly identified).

## BUG 2 — Negatives don't import (every campaign "No campaign-scoped negatives", shared list empty)

**Root cause:** the Negative Keywords tab header is `Campaign / Level | Negative Keyword | Match Type | Reason`. Two problems:
1. The scope column header `Campaign / Level` → `headerKey()` = `campaignlevel`. But `parseNegativesTab` reads `idx.scope ?? idx.campaign ?? idx.level` — none of which is `campaignlevel`. So scope is always undefined.
2. The actual scope VALUES are `ALL CAMPAIGNS` (and campaign names like `C6 – Genre`). Lowercased = `all campaigns`, which does NOT equal the checked `"all"` / `"plan"` / `""`. So even if the column were read, `ALL CAMPAIGNS` wouldn't resolve to plan-scope.

**Fix:**
- Add `campaignlevel` (and `campaignslash level` variants) to the scope-column lookup: `idx.scope ?? idx.campaign ?? idx.level ?? idx.campaignlevel`.
- Broaden the plan-scope value check: treat `all`, `all campaigns`, `plan`, `shared`, `` (empty), `all campaign` as plan-scope. Use a startsWith/`includes("all")` check rather than exact equality — `all campaigns` should map to plan-scope.
- Confirm the header-scan finds the header row: `recordsFromRawRowsWithHeaderScan(raw, ["negativekeyword"])` — `headerKey("Negative Keyword")` = `negativekeyword` ✓ should work, but the tab also has a title row above the header ("JUNCTION 2: MELODIC — NEGATIVE KEYWORD LIST"). The header scan already handles title rows by scanning for the required-header row, so this should be fine — but verify with the real sheet that the negatives header is found at all (add a `negatives_header_not_found` warning if the scan returns []).

## BUG 3 — budgets must be DAILY not monthly

The wizard/import treats budget as monthly. Matas wants daily. Two parts:
1. **Import:** the Overview tab has "Est. Monthly Budget" per campaign. Keep importing that into `monthly_budget` (it's reference info), but the campaign's `daily_budget` is what gets pushed. When the operator sets a budget in the wizard, it must write `daily_budget`. Check the Phase 2 Campaigns step + the Phase 3 push adapter: the push uses `daily_budget` for the campaignBudget amountMicros (Google campaign budgets ARE daily). Confirm the adapter reads `daily_budget` (× 1_000_000 for micros), NOT `monthly_budget`.
2. **Wizard budget field:** in the Campaigns step, the budget input should be labelled "Daily budget (£)" and write `daily_budget`. If it currently writes `monthly_budget`, fix it. Optionally show the imported monthly figure as a greyed reference ("plan suggests £350/mo").
3. **Bulk-set helper:** since Matas wants to set £1/day across all campaigns quickly, add a "Set all daily budgets" input at the top of the Campaigns step that fills every campaign's `daily_budget` with the entered value. Small UX win, saves setting 7 budgets one by one.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/google-search/ components/google-search-wizard/ lib/google-ads/
node --experimental-strip-types --test 'lib/google-search/__tests__/*.test.ts'
npm run build
```

Tests — use a fixture that mirrors the REAL J2 structure (section-header rows with blank Campaign column, campaign appearing twice for H-block and D-block, `Campaign / Level` negatives header, `ALL CAMPAIGNS` scope value):
- Ad Copy: section-header carry-forward attaches H1..H15 + D1..D4 to the right campaign → assert each campaign's RSA has the expected headline + description counts (e.g. C1 = 15 headlines + 4 descriptions)
- Ad Copy: campaign appearing twice (H-block then D-block) accumulates into ONE RSA, not two
- Negatives: `Campaign / Level` header is read; `ALL CAMPAIGNS` → plan-scope; `C6 – Genre` → campaign-scope matched to the skeleton campaign
- Negatives: assert 23 negatives parsed from the J2 fixture (or whatever the real count is)
- Budget: push adapter reads daily_budget for amountMicros, not monthly_budget
- Re-import the full J2 fixture end-to-end → assert 0 "empty_rsa" warnings, negatives count > 0

## NON-NEGOTIABLES

- Branch: exactly `creator/google-search-xlsx-import-fixes`
- Do NOT add migrations
- Do NOT touch the mutate adapter's chain logic — only confirm/fix which budget field it reads
- Do NOT regress the existing 12 xlsx-import tests — extend, don't break
- The section-header carry-forward must be robust to the campaign appearing in both the Keywords tab AND twice in the Ad Copy tab with slightly different casing

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-google-search-xlsx-import-fixes.md`. PR title: `fix(creator): xlsx import RSAs + negatives + daily budgets`. Document the section-header carry-forward approach + the negatives scope-column fix.

## AFTER THIS MERGES

Matas re-imports the J2 plan on the LWE account, confirms RSAs + negatives populate + sets £1 daily budgets, then pushes. This is the smoke test that proves the full path before any real client launch.
