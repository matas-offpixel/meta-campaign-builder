# TikTok targeting correctness

## PR

- **Number:** 810
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/810
- **Branch:** `cursor/tiktok-targeting-correctness`

## Summary

An audit found TikTok targeting that was selectable and persisted but silently
not sent, or sent wider than chosen. This PR closes all seven findings before
the preset system is expanded (presets create interest groups, and issue 1
silently dropped every group created after Step 6's first visit).

Nothing here changes the write killswitch, `operation_status: DISABLE`,
rollback, idempotency, the identity path, the cover-image path, or the
optimisation-event deny-list. No genre presets were expanded. No Meta code was
touched.

## The seven issues

### 1. Ad-group list froze on first visit (critical)

`components/tiktok-wizard/steps/assign-creatives.tsx` wrote
`budgetSchedule.adGroups` once in a mount effect with an empty dependency
array, and `suggestTikTokAdGroups` short-circuited on
`adGroups.length > 0` forever after. An interest group added afterwards never
became an ad group — its targeting never launched. A deleted interest group
left an ad group whose `interestGroupId` no longer resolved, and
`targetingIdsForAdGroup` in `lib/tiktok/write/mapping.ts` then applied the
FLATTENED UNION of every group's targeting to it.

Fixed with a pure reconciler, `lib/tiktok-wizard/ad-group-reconcile.ts`:

- If at least one non-empty interest group exists, ad groups are 1:1 with those
  groups, in interest-group order. An ad group already carrying a matching
  `interestGroupId` is preserved verbatim so operator edits (names from #808,
  budgets, per-group schedules) survive.
- Positional stubs (no `interestGroupId`) are dropped once interest groups take
  over — their targeting is not expressible as an interest group, so keeping
  them would send the flattened union. The rule is documented at the top of the
  module.
- With zero non-empty interest groups, positional ad groups are the truth:
  existing ones keep their edits, orphans are dropped, and when nothing is left
  a fresh `Ad group 1/2/3` set is generated.
- Empty interest groups never create ad groups
  (`isTikTokInterestGroupNonEmpty`).

`suggestTikTokAdGroups` now returns the reconciled list, so preflight, the
orchestrator, cover-image resolution, the brief export, and review all read a
list that matches the current audience rather than a stale snapshot. Step 6
persists the reconciled list whenever the id signature changes (not once on
mount) and shows a dismissible banner naming what was added or removed.
Assignments for removed ad groups are pruned via `pruneTikTokAssignments`, so
a creative assigned only to a deleted ad group no longer reads as "assigned".

### 2. Clearing the UI did not clear the payload

`flattenTikTokInterestGroups` merged the PREVIOUS flat IDs back in whenever no
group was non-empty, so an operator who emptied or deleted every group still
launched with the targeting they had just removed. The merge-back and its
`previous` parameter are gone. Legacy flat targeting still survives the
migration path, because `addGroup` seeds a non-empty group from it via
`seedTikTokInterestGroupFromLegacy`.

### 3. Gender silently widened

TikTok's ad-group `gender` is only `GENDER_MALE` / `GENDER_FEMALE` /
`GENDER_UNLIMITED`, but the UI offers Unknown as a first-class chip and allows
multi-select. UNKNOWN alone, MALE+FEMALE, MALE+UNKNOWN, FEMALE+UNKNOWN and all
three collapse to `GENDER_UNLIMITED` — no gender targeting at all. The mapping
is TikTok's constraint and is unchanged; `tikTokGenderWideningNote` now names
it at selection time ("Female + Unknown ships as unlimited gender
(GENDER_UNLIMITED) …") in Step 3 and again in the Review audience panel.

### 4. Age silently widened

The audience control clamps to 18–65, but 65 falls inside `AGE_55_100`, so
"18–65" ships as 18–100. `tikTokAgeWideningNote` computes the effective bucket
edges from `TIKTOK_AGE_GROUP_RANGES` and states the widening, naming the
buckets. No new age API was invented.

### 5. Custom audiences and lookalikes implied per-group scoping

They sat in the same tab strip as interests/hashtags/behaviours under
"Selecting for {activeGroup.name}", but they are stored draft-wide and the
mapper applies them to every ad group. Taken out of the per-group tab strip and
moved into their own "Campaign-wide audiences" section that says so. No new
per-group schema was invented.

### 6. Lookalikes were being sent in the wrong field (verified, then fixed)

The Lookalikes tab is populated from `/dmp/saved_audience/list/` keyed on
`saved_audience_id`, and those IDs were being appended to the same
`audience_ids` array as custom audiences.

Verified against the official SDK model before changing anything:
<https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AdgroupCreateBody.md>

```
**audience_ids**         | **list[str]** | [optional]
**excluded_audience_ids**| **list[str]** | [optional]
**saved_audience_id**    | **str**       | [optional]
```

`AdgroupUpdateBody.md` carries the same two fields with the same types. So
`saved_audience_id` is a real, separate, SINGULAR field — the audit's suspicion
was correct and saved-audience IDs do not belong in `audience_ids`.

`buildTikTokAdGroupPayload` now sends custom-audience IDs in `audience_ids` and
a single saved audience in `saved_audience_id`. Because the documented field is
singular and there is no documented list form, more than one selected saved
audience is a named blocker (`mapTikTokSavedAudienceId` → preflight) rather
than a silent pick-the-first. The Lookalikes picker says the same thing.

### 7. `hasAnyTargeting` ignored languages and age

Both reach the ad-group payload (`languages`, `age_groups`), so a
language-plus-age setup read as "no targeting" in the review checklist.
Languages now count. Age counts only when the range differs from the implicit
18–65 default in `defaultTikTokAudiences()` — the draft always stores numbers,
so an untouched default is not "chosen".

## Scope / files

- `lib/tiktok-wizard/ad-group-reconcile.ts` (new) — pure reconciler + change
  description + positional defaults
- `lib/tiktok-wizard/targeting-warnings.ts` (new) — gender/age widening notes,
  campaign-wide audience copy
- `lib/tiktok-wizard/review.ts` — `suggestTikTokAdGroups` delegates to the
  reconciler; `hasAnyTargeting` counts languages and a moved age range
- `lib/tiktok-wizard/interest-groups.ts` — flatten clears instead of merging
  the previous snapshot back in
- `lib/tiktok-wizard/assign-creatives.ts` — `pruneTikTokAssignments`
- `lib/tiktok/write/mapping.ts` — `audience_ids` vs `saved_audience_id`,
  exported `TIKTOK_AGE_GROUP_RANGES`
- `components/tiktok-wizard/steps/assign-creatives.tsx` — reconcile on change,
  surface what moved
- `components/tiktok-wizard/steps/audiences.tsx` — campaign-wide audience
  section, gender/age widening notes
- `components/tiktok-wizard/steps/review-launch.tsx` — widening notes on the
  audience panel

## Validation

- [x] `npm test` — 4051 tests: 4035 passed, 13 failed, 3 skipped. The 13
      failures are the same pre-existing ones as on `main` (asset-queue
      copy-generator / sheet-parse module resolution, five dashboard
      timeline suites, `canonical-tickets-window`, and the Meta
      BUY_TICKETS rotation test). Baseline on `d18a085` was 4016 tests:
      4000 passed, 13 failed, 3 skipped — this PR adds 35 tests and fixes
      none of the 13.
- [x] `npm run lint` — no new errors or warnings in any changed file (the
      repo's 27 pre-existing errors are all in untouched files)
- [x] `npm run build` — clean

New / changed tests:

- `lib/tiktok-wizard/__tests__/ad-group-reconcile.test.ts` (new) — a group
  added after the list exists gets its own ad group and its targeting reaches
  THAT ad group's payload (asserted per ad group, not just presence); a deleted
  or emptied group's ad group is removed and no sibling inherits the union;
  edited names and budgets survive; reconciliation is idempotent; positional
  defaults are kept, dropped, and restored per the documented rule; assignments
  are pruned
- `lib/tiktok-wizard/__tests__/targeting-warnings.test.ts` (new) — every
  gender combination that collapses to `GENDER_UNLIMITED`, and 18–65 → 18–100
  naming `AGE_55_100`
- `lib/tiktok-wizard/__tests__/interest-groups.test.ts` — clearing every group
  clears the flat targeting; removing the last group clears it; the legacy
  seed path still carries targeting through
- `lib/tiktok-wizard/__tests__/review.test.ts` — languages and a moved age
  range count as targeting; the untouched 18–65 default does not
- `lib/tiktok/__tests__/write-mapping.test.ts` — `audience_ids` carries only
  custom audiences, one saved audience goes to `saved_audience_id`, two are a
  named blocker

## Notes

- Branched off `origin/main` at `d18a085`, one commit past the `477e29a` the
  brief named. `d18a085` is PR #809, a Meta-only interest-preset change with no
  TikTok overlap.
- A preserved ad group keeps its stored budget when the group count changes;
  only freshly-added ad groups take the even split. Preflight still validates
  every ad-group budget against TikTok's floor, so a stale split is blocked
  rather than launched.
- Hashtag targeting remains blocked at preflight (unverified namespace) —
  unchanged by this PR.
- Follow-up: genre-preset expansion, which depends on the reconciler landing
  here.
