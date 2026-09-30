# PR A — website destination is the default

## PR

- **Number:** 1003
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1003
- **Branch:** `cursor/destination-type-website-default`

## Summary

`destination_type: "WEBSITE"` is now the default for every objective that sends
people to a site — traffic, registration, purchase, initiate_checkout and
awareness — and one boosted post no longer strips the destination from every
website ad beside it. The reported symptom was ads reading "Facebook event" in
Ads Manager on a campaign whose ads point at a website, which an operator cannot
retarget without changing the destination by hand.

Three questions in the brief were open pending live Graph checks. All three were
answered against real Meta, so nothing here is a guess. Probe objects were
created PAUSED and deleted; the captured request/response pairs are below.

## Live checks

Run 2026-09-30 with `META_ACCESS_TOKEN` (Matas Liebus, `10243038239677083`),
Graph `v21.0`.

### 1. Does Meta accept `destination_type: WEBSITE` on awareness / engagement?

Method: per objective, create a PAUSED campaign → create a PAUSED ad set with
the field → read it back → delete. Repeated for every goal in
`VALID_GOALS_BY_OBJECTIVE`, on `act_932846012721428`.

| Objective | Goals probed | Verdict | Read back |
|---|---|---|---|
| `OUTCOME_TRAFFIC` | LANDING_PAGE_VIEWS, LINK_CLICKS, REACH, IMPRESSIONS | accepted | `WEBSITE` |
| `OUTCOME_LEADS` | OFFSITE_CONVERSIONS (×2 event types) | accepted | `WEBSITE` |
| `OUTCOME_SALES` | OFFSITE_CONVERSIONS + PURCHASE | accepted | `WEBSITE` |
| `OUTCOME_SALES` | OFFSITE_CONVERSIONS + INITIATED_CHECKOUT | accepted | `WEBSITE` |
| **`OUTCOME_AWARENESS`** | REACH, IMPRESSIONS, THRUPLAY | **accepted** | `WEBSITE` |
| **`OUTCOME_ENGAGEMENT`** | POST_ENGAGEMENT, THRUPLAY | **rejected** | — |

**Awareness accepts it**, so it is now in the default set. #770 left it out
without testing it.

**Engagement rejects it**, so it stays unset:

```
code=100 error_subcode=2490408
error_user_title: "Performance goal isn't available"
error_user_msg:   "You can't use the selected performance goal with your campaign
                   objective. Please select a different goal or edit your campaign."
```

Meta's wording blames the goal, which is misleading. The control proves the
field is what flips it: the same campaign and the same `POST_ENGAGEMENT` goal,
with the field omitted, was **accepted** (ad set `120246860050170582`). Live
engagement ad sets carry `ON_POST`, which Meta assigns itself.

Two side findings worth recording:

- Meta returns the literal string `"UNDEFINED"` — not `null`, not an absent key
  — for an ad set created without the field. Named as
  `META_DESTINATION_TYPE_UNSET` and handled everywhere the value is read.
- Meta now requires `is_adset_budget_sharing_enabled` on campaign create
  (`code=100 subcode=4834011`). The app already sends `false`; noted only
  because a probe that omitted it failed first.

### 2. Does a boost attach to a `WEBSITE` ad set (subcode 1815676)?

Method: on `act_968594768066330` with the real DHB page (`104589464429084`),
one PAUSED `OUTCOME_TRAFFIC` campaign holding two ad sets — one with
`destination_type=WEBSITE`, one with the field omitted as a control. Six
creative/ad combinations, both boost shapes, with and without #983's
`call_to_action.value.link`.

| Creative | Ad set | #983 link | Result |
|---|---|---|---|
| `source_instagram_media_id` | `WEBSITE` | yes | **ad created** |
| `source_instagram_media_id` | `WEBSITE` | no | **ad created** |
| `source_instagram_media_id` | omitted | no | ad created |
| `object_story_id` | `WEBSITE` | yes | **ad created** |
| `object_story_id` | `WEBSITE` | no | **ad created** |
| `object_story_id` | omitted | no | ad created |

**Subcode 1815676 never fired.** Meta's behaviour has changed since #777 (task
#132). The answer is stronger than the brief's §2 "yes" branch: acceptance does
not even depend on the creative carrying a URL, so a bare engagement boost also
attaches. #777's `hasBoostCreative` branch is deleted outright and the fallback
described in the "no" branch — giving link-less boosts their own ad set — is not
needed and was not built.

### 3. Does Meta accept `destination_type` on an update?

Relevant to PR B, verified here because PR A's preflight tells operators to use
that action.

| Test | Ad set | Request | Response |
|---|---|---|---|
| A — paused, value change | own account, created without the field | `POST destination_type=WEBSITE` | `{"success": true}`, reads back `WEBSITE` (was `UNDEFINED`) |
| B — running, same value | `120250102008580453` "All customs 2", ACTIVE, £23.29 / 6,635 impressions | `POST destination_type=WEBSITE` | `{"success": true}` |
| C — running, value change | `120249993287300453` "DHB" on `[DHB26-RELEASE] USA – v2`, ACTIVE, £0.23 / 40 impressions | `POST destination_type=WEBSITE` | `{"success": true}`, `UNDEFINED` → `WEBSITE` |

Test C also left `learning_stage_info.last_sig_edit_ts` **unchanged**
(`1789735176` before and after), so Meta did not treat the write as a
significant edit and the ad set's learning phase did not reset. That ad set is
the one live ad set this branch's investigation mutated; the value it now holds
is the value PR B would have given it.

## What the reported reproducer actually was

The brief's root cause does not hold for `DHB Primary 2` / ad *Video – DHB*, and
the difference is worth recording so the next person does not re-derive it:

- **All 8 ad sets on `[DHB26-DUBAI] TRAFFIC` already read
  `destination_type=WEBSITE`**, including `DHB Primary 2`. Omission cannot be
  what that screen showed.
- **The DHB page has no upcoming events** — 16 events, most recent start
  2024-12-29. The "Page has an upcoming event" precondition is absent.
- **The link description is the app's own copy, not Meta's event rendering.**
  Creative `1750090042946243` carries
  `asset_feed_spec.descriptions[0].text = "Buy DHB tickets for 7 November 2026 at
  Skydive Dubai in Dubai. …"`. That is `creative.description` going out through
  the multi-placement path. Separately that creative has **no `titles` at all**,
  and the 2026-09-30 creatives carry `titles: [{"text": ""}]` — an empty
  headline. The string quoted in the report, "DHB Tickets Dubai 2026 – Party",
  is the **creative name**, which is what Ads Manager falls back to in a preview
  with no headline.

The headline/description half is a separate defect and is **not** fixed here —
it is PR C.

The damage this PR does fix is real and live, just elsewhere: every
`OUTCOME_SALES` ad set has never carried a destination. 12 ACTIVE ad sets across
the three `[DHB26-RELEASE]` campaigns read `UNDEFINED`, as do all 21 on the
`OUTCOME_LEADS` Announce campaign.

## Scope / files

- `lib/meta/adset.ts` — `WEBSITE_DESTINATION_OBJECTIVES`,
  `isWebsiteDestinationObjective`, `META_DESTINATION_TYPE_UNSET`;
  `resolveAdSetDestinationType` loses its `hasBoostCreative` parameter;
  `buildAdSetPayload` loses the same positional parameter; new
  `findAdSetsWithoutWebsiteDestination` + `websiteDestinationRefusalMessage`;
  deleted `adSetHasBoostCreative` and
  `findAdSetsWithMixedBoostAndLinkCreatives`, which only existed for #777.
- `app/api/meta/launch-campaign/route.ts` — `boostAdSetIds` gone, along with the
  argument at all 8 `buildAdSetPayload` call sites; website-destination preflight
  in the `attach_adset` branch of Phase 1 (live Graph value) and a
  resolved-value guard before Phase 0 for ad sets this launch creates.
- `lib/meta/client.ts` — `fetchAdSetById` also reads `destination_type`;
  `RawMetaAdSet.destination_type`. A field on an existing read, not a new helper.
- `components/steps/assign-creatives.tsx` — removed the Step 6 note telling
  operators Meta's Edit UI "may show Facebook event as the destination". It is no
  longer true and it described the bug as cosmetic.
- `lib/meta/import/types.ts` — `destination_type` out of
  `META_IMPORT_UNCARRIABLE_TARGETING_FIELDS`.
- `lib/meta/import/map.ts` — carries the source value onto
  `AdSetSuggestion.importedDestinationType`; names a missing or `UNDEFINED`
  source on `dropped[]` as `destination_type_defaulted`.
- `lib/types.ts` — `AdSetSuggestion.importedDestinationType`.

### Deliberate deviation from the brief

The brief asks the importer to carry `destination_type` "so relaunch preserves
it". The field is carried and surfaced, but it does **not** decide the relaunch
payload — `resolveAdSetDestinationType` still does. Two reasons, both to avoid
guessing:

1. A source ad set reading `UNDEFINED` (every DHB ad set) or `FACEBOOK_EVENT` is
   the damage being fixed. Preserving it would relaunch the bug.
2. `WEBSITE` is the only value verified as accepted on create. Copying an
   arbitrary source value — `ON_POST`, `SHOP_AUTOMATIC` — into a create payload
   would be shipping an untested value.

For the case where preserving matters, a source already reading `WEBSITE`, the
carried value and the default agree; the Ironworks fixture asserts it.

## Guards honoured

- No migration.
- No new write helpers (#969) — still `createMetaAdSet` with one more field on
  the payload it already builds.
- No changes under `lib/tiktok/**`, `lib/optimisation/**`, `lib/google-ads/**`,
  `lib/google-search/**`.

## Validation

- [x] `npx tsc --noEmit` — no new errors. Pre-existing failures on `main`
      (missing `@types/jest`, stale `LaunchSummary` fixtures) are unchanged.
- [x] `npm test` — 6,479 pass, 0 fail, 6,482 total.
- [x] `npm run build` — green.
- [x] `npm run lint` — 220 problems, all pre-existing on `main` (verified for
      `components/steps/assign-creatives.tsx`, whose two unused-import warnings
      are present on `main` too).

Tests added or rewritten:

- `lib/meta/__tests__/adset-destination-type.test.ts` — rewritten. Golden per
  objective across every valid goal; engagement omits the key rather than
  sending `undefined`; a stray 10th argument cannot resurrect #777's downgrade;
  the preflight refuses `UNDEFINED`, absent, and `FACEBOOK_EVENT`, never refuses
  engagement, and reports every offending ad set; the message names the ad set,
  its id, and what it carries.
- `lib/meta/import/__tests__/destination-type-carry.test.ts` — new. DHB fixture
  (21 ad sets, all `UNDEFINED`) carries the value, gets 21
  `destination_type_defaulted` notes, no longer reports `destination_type` as
  uncarriable, and relaunches as `WEBSITE` on all 21 including `DHB Primary 2`.
  Ironworks fixture (30 ad sets, all `WEBSITE`) carries it through with no note.
- `lib/meta/__tests__/launch-campaign-placement-wiring.test.ts` — #777's guard
  inverted: no call site may pass a boost flag, and `boostAdSetIds` must be gone
  from the route.
- `lib/meta/__tests__/initiate-checkout-objective.test.ts` — pinned purchase and
  awareness goldens gain `destination_type: "WEBSITE"`, annotated with why the
  "byte-identical" pin moved.
- `lib/meta/__tests__/paused-everywhere-audit.test.ts` — positional argument
  fixed after the parameter removal.

## Notes

- `scripts/backfill-traffic-destination-type.mjs` still skips ad sets with boost
  creatives, per #777. It is now over-cautious rather than wrong. PR B replaces
  it with a gated, ledgered action; left alone here to keep this diff to the
  launch path.
- Follow-up: the empty `titles` and the unexpected link description on
  multi-placement creatives — PR C.
