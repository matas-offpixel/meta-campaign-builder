# TikTok import audit — why #944 shipped green and does not work

**Date:** 2026-09-15
**Code audited:** `main` at `99be163` (#944, merged). Every `file:line` below is that commit.
**Evidence:** the live run on Ironworks advertiser `7639802149165301776`, recorded in
`pr-944-live-capture-2026-09-15.md`. No TikTok calls were made from this worktree.
**Provenance rule used throughout:** every claim about a response shape is marked
*live* (seen in the run), *rejected live* (named in the `/adgroup/get/` error body),
*doc* (with a URL), *third-party mirror* (an SDK or connector schema, corroboration
only), *guessed* (no source), or *unknown until capture*.

## The one-paragraph answer

CI was green because the only fixture is a file the mapper's own author wrote. Two
kinds of error survive that: a field *name* TikTok rejects (`connection_type`, which
kills every manual import before a row is read), and a field *nesting* TikTok never
uses (`creative_list[].video_id`, which turns 45 real creatives into 45 hollow ones).
The second class is no longer unknown. TikTok's own reference for this endpoint
documents `creative_list[]` as `{ ad_material_id, material_operation_status,
creative_info: { … video_info: { video_id } … } }` and documents the ad-level id as
`smart_plus_ad_id`, not `ad_id` —
<https://business-api.tiktok.com/portal/docs/get-upgraded-smart-ads/v1.3>. Four of the
mapper's per-row reads on that endpoint are at the wrong key, and three more are at
the wrong *level* (ad-group text/CTA/landing page read as if per-creative). That
single doc page explains every number in the bad draft. It also means the amendment
to PR 1 is larger than "confirm the note": the note's section E says the
`creative_list` keys are unknown; they are documented, and the capture's job changes
from *discovery* to *confirmation*.

One thing the audit clears: **preflight is not a gap.** A reconstruction of draft
`c8bca9ff…` run through the real `collectTikTokLaunchPreflight` is blocked, three
different ways. The expected PR 3 is not needed. Details in *Preflight*.

---

## 1 — Shape: every key the code reads, with provenance

### 1.1 `/campaign/get/` — `CAMPAIGN_GET_FIELDS`, `readers.ts:136–148`

Ten names. The picker listed 11 campaigns with correct names, objectives, statuses
and kinds, so **all ten names are accepted live**. Values observed live:
`campaign_id`, `campaign_name`, `objective_type`, `operation_status`, and whichever of
`campaign_automation_type` / `is_smart_performance_campaign` drives
`classifyTikTokCampaign` (6 upgraded / 5 manual / 0 legacy was correct).
`virtual_objective_type`, `sales_destination`, `budget`, `budget_mode` are accepted
names whose **values were never observed** — `applyCampaignFields` (`map.ts:466–483`)
consumes all four.

> **Finding 1.1 — `secondary_status` is read as a status fallback (`readers.ts:271`)
> but the two fields are not interchangeable.** Severity: *cosmetic*. `operation_status`
> is ENABLE/DISABLE; `secondary_status` is a review/delivery state, so the picker's
> Status column can show a delivery state for one campaign and an on/off state for the
> next. **Fix:** show `operation_status` only and render `secondary_status` as a
> separate column or not at all.

### 1.2 `/adgroup/get/` — `ADGROUP_GET_FIELDS`, `readers.ts:150–187`

Thirty-six names. TikTok rejected `fields.32`; index 32 counting from zero is
`connection_type` (`readers.ts:183`).

| Indices | Names | Provenance |
|---|---|---|
| 0–31 | `adgroup_id` … `device_model_ids` | Accepted — TikTok reported index 32, and a lower bad index would have been reported instead. Inference from the live error, not a success response. |
| 32 | `connection_type` | **Rejected live.** *Guessed* — it is in no TikTok reference. A third-party v1.3 ad-group schema mirror also omits it while listing `network_types` (<https://docs.airbyte.com/ai-agents/connectors/tiktok-marketing/REFERENCE>). |
| 33–35 | `carrier_ids`, `isp_ids`, `network_types` | Named as present in the captured 152-name accepted list per the live note. **Unverified until that list is pinned** — TikTok reports one offending index per request, so indices after 32 were never adjudicated. |

> **Finding 1.2 — `connection_type` blocks every manual import.** Severity: *blocks
> import*. `readers.ts:183`. **Fix:** delete the name and add a test asserting
> `ADGROUP_GET_FIELDS ⊆` the captured accepted-field list.

> **Finding 1.3 — removing `connection_type` may only reveal the next bad name.**
> Severity: *blocks import*. `readers.ts:183–186`. Indices 33–35 have never been
> validated by TikTok. **Fix:** validate the whole array against the captured list in
> one test rather than removing one name and re-driving the UI.
>
> **Amended 2026-09-15 after review.** `carrier_ids`, `isp_ids` and `network_types`
> *are* in the live accepted list, so indices 33–35 are adjudicated and this finding
> is downgraded to a test, not a risk. PR 1 validates the whole array anyway — and
> in doing so surfaced the more awkward fact: the 152-name body was truncated
> before it reached the worktree, so the pinned fixture is **partial** (19 names).
> The remaining 23 names `ADGROUP_GET_FIELDS` sends are tracked in an explicit
> `PENDING_CAPTURE` list that the test forces to stay in sync. The capture round
> replaces both with the verbatim body.

> **Finding 1.4 — `unwrapManualTargeting` reads `targeting_spec` on `/adgroup/get/`
> rows (`map.ts:118–125`), which does not return one.** Severity: *cosmetic*. The
> manual ad-group response is flat (`gender`, `age_groups`, `location_ids` at top
> level — third-party mirror above; the live manual call has never succeeded, so this
> is **unknown until capture**). The unwrap is a harmless no-op today but it is a
> guessed key sitting in the path that is about to run for the first time. **Fix:**
> delete it, or keep it and assert in the round-trip test that it never fires.

### 1.3 `/ad/get/` — `AD_GET_FIELDS`, `readers.ts:189–206`

Sixteen names, **all accepted live** (45 rows returned for the upgraded campaign,
with `filtering.campaign_automation_type: "UPGRADED_SMART_PLUS"` — that filter is now
*verified live* and should leave the unverified list). Values observed live: `ad_id`,
`ad_name`, `video_id`, `image_ids`, `tiktok_item_id`. `is_aco` and `creative_authorized`
are documented response fields (third-party mirrors: Airbyte above, Qlik, Nodus) and
were **accepted as names but absent from every one of the 45 rows** — see *§5*.
`identity_id`, `identity_type`, `identity_authorized_bc_id`, `landing_page_url`,
`ad_text`, `call_to_action` are *unknown until capture* on this endpoint.

> **Finding 1.5 — `identity_bc_id` is read (`readers.ts:88`, `map.ts:278`) and never
> requested, and is not a TikTok field name.** Severity: *cosmetic*. `mapping.ts:831–834`
> already records that the real name is `identity_authorized_bc_id` and that
> "Identity_bc_ID" is prose in a TikTok error string, not a field. The `??` branch in
> `map.ts:278` can never be reached. **Fix:** drop the fallback.

> **Finding 1.6 — the mapper never requests `display_name`, `music_id`, `ad_format`
> or `image_mode`, all documented `/ad/get/` response fields** (mirrors above).
> Severity: *wrong draft*. `readers.ts:189–206`. Consequences in *§2*. **Fix:** request
> them, and drop-and-list whatever the draft cannot hold.

### 1.4 `/smart_plus/adgroup/get/` — no `fields` param, `readers.ts:335–350`

Sending no `fields` returns all fields by default (doc, stated for the sibling ad
endpoint at <https://business-api.tiktok.com/portal/docs/get-upgraded-smart-ads/v1.3>;
inferred for the ad-group endpoint). This read **worked live**: `targeting_spec`
present and unwrapped (`map.ts:127–136`), ages 18–54, `en`, location `2648110`,
`SHOPPING` on pixel `7644201699552690194`, identity `BC_AUTH_TT`, and five Smart+ flags
plus placements landed in `dropped[]`. Nothing to fix here. It is the one read that
behaved.

### 1.5 `/smart_plus/ad/get/` — no `fields` param, `readers.ts:352–367`

This is where the draft went wrong, and it is now documented rather than unknown.
Response table: <https://business-api.tiktok.com/portal/docs/get-upgraded-smart-ads/v1.3>.

| Code reads | TikTok documents | Verdict |
|---|---|---|
| `ad.ad_id` (`readers.ts:514`, `map.ts:295`) | `smart_plus_ad_id` | **Guessed.** Always `undefined` on this endpoint. |
| `ad.ad_name` (`map.ts:336`) | `ad_name` | Correct — *live* (the three group names came through). |
| `ad.creative_list` (`readers.ts:516`, `map.ts:321`) | `creative_list` | Correct — *live*. |
| `creative.creative_id` (`map.ts:295`) | `ad_material_id` | **Guessed.** No `creative_id` exists on the row. |
| `creative.video_id` (`map.ts:297`) | `creative_info.video_info.video_id` | **Wrong nesting.** Doc rows for `creative_info` → `video_info` → `video_id`. |
| `creative.image_ids` (`map.ts:298`) | `creative_info.image_info[].web_uri` | **Wrong nesting and wrong name.** |
| `creative.tiktok_item_id` (`map.ts:299`) | `creative_info.tiktok_item_id` | **Wrong level** (one deeper). |
| `creative.identity_id` / `identity_type` / `identity_authorized_bc_id` (`map.ts:300–302`) | `creative_info.identity_*`, and separately `ad_configuration.identity_*` for non-Spark | **Wrong level**, and there are two legitimate sources, not one. |
| `creative.ad_text` (`map.ts:304`) | ad-level `ad_text_list[].ad_text` | **Wrong level and wrong cardinality** — a list on the asset group, not a scalar per creative. |
| `creative.landing_page_url` (`map.ts:303`) | ad-level `landing_page_url_list[].landing_page_url` | Same. |
| `creative.call_to_action` (`map.ts:305`) | ad-level `call_to_action_list[].call_to_action` | Same. |
| `creative_auto_add_toggle`, `creative_auto_enhancement_strategy_list` read flat off the ad row (`types.ts` dropped list via `map.ts:577–582`) | children of `ad_configuration` | **Wrong level** — so the two fields that *are* the Smart+ auto-creative behaviour are never listed in `dropped[]`. |

`ad_material_id` is documented as "an ad-specific material ID generated when a
particular creative is used in an ad… differs from the creative ID you receive when
uploading the creative", so it is **not** a join key to anything in `/ad/get/`. The
`smart_plus_creative_id` added on 2026-08-21
(<https://business-api.tiktok.com/portal/docs/whats-new/v1.3>) is a further
creative-level identifier on the same endpoints; whether it appears alongside
`ad_material_id` in a live row is *unknown until capture*.

> **Finding 1.7 — four keys guessed and six read at the wrong nesting level on
> `/smart_plus/ad/get/`.** Severity: *wrong draft*. `readers.ts:98–109` (the row type),
> `readers.ts:512–525`, `map.ts:288–309`. This is the whole of symptom 2. **Fix:**
> retype the row from the documented shape and re-read every field through
> `creative_info` / the ad-level `*_list` arrays, confirming against the capture before
> merge.

### 1.6 `/campaign/spc/get/` — `readers.ts:389–407`

**Never exercised.** This advertiser has zero legacy Smart+ campaigns. Every key in
`TikTokSpcGetRow` (`readers.ts:111–134`) and the whole walk in `creativesFromSpc`
(`map.ts:344–412`) — `media_info_list[].media_info.video_info.video_id`,
`title_list[].title`, `spc_audience_age` — is *doc-derived at best and unverified*, as
is `page_size: 1000` (`readers.ts:402–404`).

> **Finding 1.8 — the legacy path cannot be captured on Ironworks and should not
> pretend to be tested.** Severity: *cosmetic* (no legacy campaign exists to import).
> `readers.ts:389–407`. **Fix:** mark the path explicitly unverified in the fixture
> provenance map (*§8*) and leave it alone until an advertiser with a legacy SPC
> appears.

---

## 2 — Silence: where a missing key becomes a plausible value

Round 2 made *envelope* misses throw (`envelope.ts`). Every *row* field is still a
silent optional read. The dangerous ones are not the reads that produce `null` — most
of those are caught downstream by preflight — but the reads that produce a **plausible
value that is a false claim about the source campaign**. Both classes below, with what
the operator sees.

### 2.1 Silent nulls that preflight does catch (loud, but late and mislabelled)

| Read | Value produced | What the operator sees |
|---|---|---|
| `map.ts:261` `videoId = asString(ad.video_id)` | `null` | Draft saves; Review shows `Ad group "…" needs at least one assigned creative with a videoId`. **This is the 45 hollow creatives.** |
| `map.ts:272` `coverImageId` | `null` | `Creative "…" needs a cover image. TikTok rejects video ads without image_ids.` |
| `map.ts:282` `landingPageUrl ?? ""` | `""` | `Creative "…" needs an absolute landing page URL`, ×45. |
| `map.ts:494` budget | `null` | `Budget is required`. |
| `map.ts:504–505` schedule | `null` | `Schedule start and end are required`. |
| `map.ts:477` bid strategy | `null` | `Choose a bid strategy before launch`. |
| `map.ts:481–482` `optimization_event` | unset | `CONVERSIONS requires an optimisation event from the selected pixel`. |

> **Finding 2.1 — a creative with no video, no image and no Spark post is saved as a
> draft instead of failing the import.** Severity: *wrong draft*. `map.ts:256–286`.
> The operator gets a library entry named "… — relaunch" that can never launch, and
> the error arrives on Review, three screens from the cause. **Fix:** throw through
> `logUnmatchedCandidates` when a row yields neither `video_id`, nor `image_ids`, nor
> `tiktok_item_id` — PR 1 rule C, confirmed.

### 2.2 Silent plausible values that nothing catches — the real hazard

These pass preflight. I verified that empirically: the reconstruction in *§6* carries
default ages and empty locations and preflight raised **no** targeting issue.

> **Finding 2.2 — an unmapped `age_groups` silently leaves the draft claiming
> 18–65.** Severity: *wrong draft*. `map.ts:220–224` sets ages only when
> `mapAgeRange` matches a known bucket (`mapping.ts:55–66`); otherwise
> `createDefaultTikTokDraft`'s 18–65 stands and Step 2 renders it as if the source
> chose it. Ironworks' live ad group is 18–54. **Fix:** treat an `age_groups` value
> present-but-unmappable as a `dropped[]` entry and refuse to leave the default in
> place silently.

> **Finding 2.3 — unmapped `location_ids` silently produce a draft with no location
> targeting, and preflight says nothing.** Severity: *wrong draft*. `map.ts:218–219`
> (set only when non-empty) and `map.ts:167–171` (`LOCATION_CODES_BY_ID` falls through
> to the raw id). Verified: preflight raised no location issue on a draft with
> `locationCodes: []`. A relaunch would run nationally. **Fix:** an empty
> `locationCodes` after a source ad group that had `location_ids` is an import
> failure, not a default.

> **Finding 2.4 — `identityId` is borrowed from whichever creative happens to have
> one.** Severity: *wrong draft*. `map.ts:414–425` (`firstIdentity`) then
> `map.ts:523–527` / `573–576` write it to `accountSetup`. With the 45 hollow creatives
> carrying `identityId: null`, the account identity was taken from an unrelated
> `/ad/get/` row. The Review identity picker then shows an identity the operator never
> chose and that may not be the group's. **Fix:** read identity from the documented
> `ad_configuration` / `creative_info` sources, and if the sources disagree, drop-and-list
> rather than pick the first.

> **Finding 2.5 — `displayName` is set to the ad name.** Severity: *wrong draft*.
> `map.ts:281`. `display_name` is a real `/ad/get/` field that is never requested
> (Finding 1.6), so every imported ad claims a display name it did not have. **Fix:**
> request `display_name` and carry it, or leave it null and let the wizard prompt.

> **Finding 2.6 — creative `mode` is inferred from `tiktok_item_id` alone.**
> Severity: *wrong draft*. `map.ts:267`. A carousel becomes `VIDEO_REFERENCE` with
> `videoId: null` — exactly the three `auto carousel generation_…` rows in the live
> draft. `ad_format` / `image_mode` are documented and unrequested. **Fix:** derive
> mode from `ad_format` and drop-and-list formats the draft cannot represent
> (`CAROUSEL_ADS`, `CATALOG_CAROUSEL`).

> **Finding 2.7 — `musicId`, `thumbnailUrl`, `durationSeconds` are hardcoded `null`.**
> Severity: *cosmetic*. `map.ts:270–271`, `map.ts:273`, `map.ts:284`. `music_id` is
> documented on both reads. **Fix:** carry `music_id`; leave the two upload-time
> fields null and say so in `dropped[]` once rather than per creative.

> **Finding 2.8 — `caption` and `adText` collapse to `""`.** Severity: *wrong draft*.
> `map.ts:279–280`. An empty ad text is a claim that the source ad had none. Combined
> with §3, the source text lives on the asset group as a *list*. **Fix:** see Finding 3.2.

> **Finding 2.9 — an unrecognised `gender` enum silently becomes "all genders".**
> Severity: *wrong draft*. `map.ts:199–204` returns `[]` both for the legitimate
> `GENDER_UNLIMITED` and for anything it does not recognise. **Fix:** map
> `GENDER_UNLIMITED` explicitly and drop-and-list anything else.

---

## 3 — Structure: an asset group is not an ad

`/smart_plus/ad/get/` rows are **asset groups**. Ironworks returned three of them
(`80% Sold`, `Overlays`, `Feed : JJ`) holding 16 / 5 / 24 creatives. The mapper
(`map.ts:318–342`) flattens each `creative_list[]` entry into one `TikTokCreativeDraft`
named after the parent group, so 45 creatives carry three distinct names.

**Is one asset group → N creatives right?** Yes, given the destination. The writer
creates a manual ad group and N manual ads (`preflight.ts:410–441` iterates creatives
per ad group; `mapping.ts:755–850` builds one ad per creative). A manual ad is one
asset plus text plus CTA plus landing page, so the asset group has to be dissolved.

**Is one `smart_plus/adgroup` → one `adGroups[]` entry right?** Yes for Ironworks —
one Smart+ ad group came back — but the code only ever reads `bundle.adGroups[0]`
(`map.ts:489`, `map.ts:535`) and assigns every creative to that one group
(`map.ts:427–433`).

> **Finding 3.1 — a multi-ad-group source campaign is silently collapsed to its
> first ad group.** Severity: *wrong draft*. `map.ts:489`, `map.ts:535`,
> `map.ts:427–433`. Budget, schedule and all targeting come from ad group 1; ad groups
> 2..n vanish with no `dropped[]` entry. **Fix:** map every ad group, or throw when
> `adGroups.length > 1` until the multi-group mapping exists.

> **Finding 3.2 — group-level text, CTA and landing page are copied onto every
> creative as if each creative had chosen them.** Severity: *wrong draft*.
> `map.ts:303–305` reads `landing_page_url` / `ad_text` / `call_to_action` per creative;
> TikTok documents them as ad-level *lists* (`ad_text_list`, `call_to_action_list`,
> `landing_page_url_list` — doc URL in §1.5). An asset group with four ad texts and
> 24 creatives has no per-creative text at all: TikTok pairs them at delivery. Copying
> text 1 onto all 24 invents a pairing the source never made. **Fix:** when a
> group-level list has exactly one entry, carry it to every creative in that group;
> when it has more than one, put the whole list in `dropped[]` with the group name and
> leave the creatives' text empty for the operator to set.

> **Finding 3.3 — `ad_configuration` is not read at all.** Severity: *wrong draft*.
> `readers.ts:77–96` (the row type has no `ad_configuration`). It holds the non-Spark
> identity, `dark_post_status`, `creative_auto_add_toggle` and
> `creative_auto_enhancement_strategy_list` — the last two being precisely the
> automation this whole feature exists to escape, and neither is currently named in
> `dropped[]`. **Fix:** read `ad_configuration` and list everything in it the draft
> cannot hold.

---

## 4 — The split: what can actually join the two reads

> **Amended 2026-09-15 after review — twice.**
>
> **(a) The join key is documented, and this section missed it.** The same
> `get-upgraded-smart-ads/v1.3` page gives `creative_list[].smart_plus_creative_id`
> as *"the same as the `ad_id` you receive from `/ad/get/` when you do not specify
> the `ad_ids_v2` filter"*. That is a direct equality, so the join below (`video_id`
> first) is demoted: `smart_plus_creative_id === ad_id` is the primary key,
> `video_id` and `tiktok_item_id` are the fallbacks. #944 assumed the right
> equality on the wrong key name. The capture becomes a confirmation of a
> documented shape rather than a discovery.
>
> **(b) The split no longer decides what is imported.** Matas: *"I only want to
> create the original launched campaign, whose creatives are in the TikTok ad
> library."* The carry rule is Creative Library membership
> (`/file/video/ad/search/`), not provenance — so `chosen` vs `TikTok-added`
> survives only as a label in `importMeta`, and everything not carried is reported
> in `importMeta.notCarried[]` with a name, an `ad_id` and a reason. Nothing lands
> in `creatives.items` unassigned. Findings 4.1–4.3 below still hold and are all
> fixed in PR 1; the *design* paragraph that follows is superseded by that rule.

`ad_id === creative_id` is falsified twice over: `/smart_plus/ad/get/` has no
`creative_id` (it has `ad_material_id`) and no `ad_id` (it has `smart_plus_ad_id`).
`creativeKeysFromSmartPlusAd` (`readers.ts:512–525`) therefore built an **empty** key
set, so the filter at `readers.ts:466–469` classified all 45 `/ad/get/` rows as
auto-added, and `creativesFromSmartPlusAds` produced 45 keyless duplicates alongside
them.

The doc also fixes the *semantics*, which matter more than the key:

> `creative_list` … only returns creatives that you have explicitly selected.
> Automatically added creatives are not included… To retrieve all creatives in a
> campaign, including those added automatically, use `/ad/get/`.
> — <https://business-api.tiktok.com/portal/docs/get-upgraded-smart-ads/v1.3>

So **chosen ⊆ all**. On Ironworks, 45 chosen and 45 total means *zero* auto-added, and
the honest `creativeCounts` is `{ chosen: 45, tiktokAdded: 0 }`, not `{45, 45}`.

**Design.** Make `/ad/get/` the single source of creatives — it is the only one of the
two that returns a launchable manual shape (`video_id`, `image_ids`, `tiktok_item_id`,
identity, landing page). Use `/smart_plus/ad/get/` only to *label* which of those rows
the operator chose. Join on what both sides document:

1. `creative_info.video_info.video_id` ↔ `/ad/get/` `video_id` — for video creatives.
2. `creative_info.tiktok_item_id` ↔ `/ad/get/` `tiktok_item_id` — for Spark.
3. Never `ad_material_id`: documented as ad-specific and explicitly not the library
   creative id, with no counterpart in `/ad/get/`.

Every `/ad/get/` row that matches a `creative_list` entry is **chosen and assigned**;
every row that does not is **TikTok-added and unassigned**. Every `creative_list` entry
that matches no `/ad/get/` row is an **unjoined** creative: counted, surfaced on Step 1
and Review as `n source creatives could not be matched to an ad`, and never silently
placed on either side.

> **Finding 4.1 — the join key does not exist, so the split is meaningless and the
> creative list is doubled.** Severity: *wrong draft*. `readers.ts:463–469`,
> `readers.ts:512–525`, `map.ts:562–572`. **Fix:** join on `video_id` / `tiktok_item_id`
> per above, take creatives from `/ad/get/` only, and report an `unjoined` count.

> **Finding 4.2 — `creativeCounts.chosen` is computed twice, differently, in one
> file.** Severity: *cosmetic*. `map.ts:660–668` sums `creative_list` lengths;
> `map.ts:589–592` overwrites it with `chosen.length`. **Fix:** compute it once, from
> the join result.

> **Finding 4.3 — zero explicitly-selected creatives is treated as an import
> failure.** Severity: *blocks import*. `readers.ts:458–462` and `map.ts:326–330`
> throw when `/smart_plus/ad/get/` returns no ads or an empty `creative_list`. Per the
> doc quote above, a fully-automated Smart+ campaign legitimately has an empty
> `creative_list`; the failure condition is an empty **union**. **Fix:** throw only
> when the campaign yields zero creatives across both reads.

---

## 5 — The counts and the line: absent is not false

`enhancementsFromAds` (`types.ts:205–223`) counts `=== true` over all rows and reports
`isAcoOn / isAcoTotal`. `is_aco` and `creative_authorized` are documented `/ad/get/`
response fields, were requested (`readers.ts:203–204`), were accepted as names, and
came back **absent on all 45 rows** — TikTok appears not to populate them for upgraded
Smart+ ads. The Review line therefore read *"is_aco true on 0 of 45"*, which asserts
the source had enhancements off. It asserted something the API never said.

**The honest shape.** Three counters per flag, not two:

```
{ on: number, off: number, absent: number }   // on + off + absent === total
```

**The sentence for each case**, upgraded Smart+:

| State | Review line |
|---|---|
| `absent === total` | *Source: Upgraded Smart+ — TikTok did not report `is_aco` on any of the 45 source ads. Relaunch: OFF.* |
| `absent === 0` | *Source ads: enhancements on 3 of 45 (`is_aco`). Relaunch: OFF.* |
| `0 < absent < total` | *Source ads: enhancements on 3 of 31 reported; 14 of 45 not reported. Relaunch: OFF.* |
| legacy | unchanged — *Source: Legacy Smart+ — fully automated creative and targeting. Relaunch: OFF.* |

> **Finding 5.1 — an absent `is_aco` is counted as `false` and rendered as a positive
> claim.** Severity: *cosmetic* (it misinforms; it does not corrupt the draft).
> `types.ts:205–223`, rendered via `types.ts` `formatTikTokImportEnhancementLine` and
> `review-launch.tsx`. **Fix:** return `{on, off, absent}` and select the sentence from
> the table above.

> **Finding 5.2 — the persisted shape cannot hold `absent`.** Severity: *cosmetic*.
> `migrate-draft.ts:129–136` normalises exactly four numbers and coerces anything else
> to `0`, so an older draft re-read after the fix silently reports `absent: 0`.
> **Fix:** add the two `absent` counters to `normalizeImportMeta` and default them to
> `null`, not `0` — `null` means "this draft predates the distinction".

> **Finding 5.3 — `"Relaunch: OFF."` is a literal, not a derivation.** Severity:
> *cosmetic*. It is true because `mapping.ts:847` hardcodes `is_aco: false`, and a test
> pins the pair. **Fix:** keep the pinning test and reference
> `TIKTOK_IMPORT_RELAUNCH_ENHANCEMENTS` from the line so the two cannot drift.

---

## 6 — Preflight: not a gap. Verified, not reasoned.

I reconstructed draft `c8bca9ff…` from the live numbers — 45 hollow creatives
(`videoId: null`, `landingPageUrl: ""`, ids `import-creative-1…45`, names `80% Sold`
×16 / `Overlays` ×5 / `Feed : JJ` ×24) all assigned to one ad group, plus 45 real
unassigned ones, with `GBP`, `Etc/GMT`, a pixel, an event, a budget and a valid future
schedule so nothing else would mask the result — and ran it through the real
`collectTikTokLaunchPreflight`. **`ok: false`, seven issues:**

```
[adgroup-creative-1876044101888034] Ad group "Smart+ group" needs at least one
    assigned creative with a videoId
[landing-import-creative-1]   Creative "80% Sold" needs an absolute landing page URL
[ad-import-creative-1-video_id]   80% Sold: Creative 80% Sold is missing a videoId
[landing-import-creative-17]  Creative "Overlays"  …
[ad-import-creative-17-video_id]  Overlays: …
[landing-import-creative-22]  Creative "Feed : JJ" …
[ad-import-creative-22-video_id]  Feed : JJ: …
```

I also ran the harder case — 44 hollow creatives assigned *alongside one real one*,
which clears the "at least one with a videoId" gate at `preflight.ts:338–347`. Still
`ok: false`: `buildTikTokAdPayload` rejects each asset-less creative individually
(`mapping.ts:786–788` `video_id`, `mapping.ts:795–800` `landing_page_url`,
`mapping.ts:802–807` `image_ids`), surfaced through `preflight.ts:421–440`.

**Conclusion: there is no preflight gap, and the expected PR 3 is not needed.**
`lib/tiktok/write/**` stays frozen, which is the outcome this arc wanted anyway. No
trade to name.

> **Finding 6.1 — the collapsed message hides how many creatives are affected.**
> Severity: *cosmetic*. `preflight.ts:622–632` dedupes on `field:message` before
> `collapseTikTokLaunchPreflightIssues` (`preflight.ts:568–620`) can count, so 16
> identical `"80% Sold"` issues become one line with no `(16 creatives)` suffix. The
> operator sees three problems where there are 45. **Fix:** carry the member ids
> through dedupe so the collapse can count — `lib/tiktok/write/**`, so **not this
> thread**; log it and leave it.

---

## 7 — Manual round-trip on `1874233177915634`

Once the manual path runs, importing `[IRW0001] Jamie Jones -signup 20 - Interests 2`
and diffing against the draft our own writer launched it from is the only test that
says the mapper is right, because it is the only case where the expected output
already exists.

**Must match exactly** — a difference is a mapper bug:

`campaignSetup.objective`, `optimisationGoal`, `bidStrategy`; `accountSetup.advertiserId`,
`pixelId`, `optimisationEvent`, `currency`, `timezone`, `identityId`, `identityType`,
`identityBcId`; `audiences.locationCodes`, `ageMin`, `ageMax`, `genders`, `languages`,
`interestCategoryIds`, `interestKeywordIds`, `behaviourCategoryIds`, `customAudienceIds`;
`budgetSchedule.budgetMode`, `budgetAmount`; `optimisation.targetCostPerResult`,
`pacing`; the ad group's `name`; and per creative — compared **as a set keyed on
`videoId`**, not on id — `videoId`, `sparkPostId`, `coverImageId`, `landingPageUrl`,
`adText`, `cta`, `displayName`.

**Expected to differ** — assert the difference rather than ignoring it:

| Field | Expected |
|---|---|
| `id` | new uuid |
| `campaignSetup.campaignName` | source name + `" — relaunch"`, collision-suffixed (`map.ts:678–700`) |
| `publishedIds` | `null` (`map.ts:691`) |
| `budgetSchedule.scheduleStartAt` / `EndAt` | healed forward by `duplicateTikTokDraftState`; assert only that end > start and start is in the future |
| creative `id` | source `ad_id`, where the original draft had a local id |
| `creativeAssignments.byAdGroupId` key | source `adgroup_id`, where the original had a local id — compare the *sets of videoIds per group* |
| `createdAt` / `updatedAt` / `status` | new |
| `importMeta` | present on the import, `null` on the original |

**The source cannot supply** — assert null/empty and that they appear in `dropped[]`
or are prompted for, never silently invented:

`eventId` (the launch blocker at `preflight.ts:94–101` — deliberate), `clientId`,
`templateId`, creative `videoUrl` / `thumbnailUrl` / `durationSeconds` (upload-time,
not returned by any read), `baseName` / variation naming, and any interest **group**
structure (`audiences.interestGroups`) — TikTok returns flat id lists, so the original
draft's grouping cannot round-trip and must be diffed as a flattened id set.

Shape of the test: a fixture pair — the captured six envelopes for
`1874233177915634` and a snapshot of the original draft row — with three assertion
blocks named `MUST_MATCH`, `EXPECTED_TO_DIFFER`, `SOURCE_CANNOT_SUPPLY`, so a new
field added to `TikTokCampaignDraft` fails the test until someone classifies it.

---

## 8 — The fixture: make "doc-derived" unable to impersonate a capture

`doc-derived-v1.3.ts` passed every test and is wrong in the two places that decided
both failures. It could not have caught either: a hand-written fixture cannot reject a
field name, and it asserts the nesting its author believed in.

**The strategy.**

1. **Two directories, not one filename convention.**
   `lib/tiktok/import/__fixtures__/captured/` and
   `lib/tiktok/import/__fixtures__/doc-derived/`. A filename can be skimmed past; an
   import path cannot. Precedent already in the tree:
   `lib/tiktok/__tests__/captured-ironworks-2026-09-10.ts` from #927, whose header names
   the advertiser, the date, the endpoint and the envelope keys — reuse that header
   verbatim.
2. **A provenance map the tests read, not prose.**
   ```ts
   export const TIKTOK_IMPORT_PATH_PROVENANCE = {
     "/campaign/get/":            "captured",
     "/adgroup/get/":             "doc-derived",   // accepted-field list captured; no success body yet
     "/ad/get/":                  "captured",
     "/smart_plus/adgroup/get/":  "captured",
     "/smart_plus/ad/get/":       "captured",
     "/campaign/spc/get/":        "uncapturable", // no legacy campaign on any connected advertiser
   } as const;
   ```
3. **Three tests that make the map load-bearing.**
   - Every path marked `captured` must have a file under `__fixtures__/captured/`, and
     the mapper tests for that path must import from there — a doc-derived fixture may
     not be the *only* fixture for a path that has been driven live.
   - Every path marked `doc-derived` or `uncapturable` must appear verbatim in the PR
     body's unverified list; the test greps the session log. Removing a fixture's
     doc-derived status without capturing it fails.
   - Every name in `CAMPAIGN_GET_FIELDS`, `ADGROUP_GET_FIELDS`, `AD_GET_FIELDS` must
     appear in a captured accepted-field list for that path, or be listed in an
     explicit `UNVERIFIED_FIELD_NAMES` allowlist. This is the test that would have
     caught `connection_type` in CI.
4. **The first real fixture.**
   `lib/tiktok/import/__fixtures__/captured/adgroup-get-accepted-fields-2026-09-15.ts` —
   the 152 names from the live error body, header: *captured from the live
   `/adgroup/get/` error body (not a success response), advertiser 7639802149165301776,
   2026-09-15*. That distinction matters: it proves which names are *accepted*, and
   proves nothing about what a success body *returns*.

> **Finding 8.1 — a doc-derived fixture is the sole fixture for all six paths and
> nothing in CI says so.** Severity: *blocks import* (it is the reason both failures
> shipped). `lib/tiktok/import/__fixtures__/doc-derived-v1.3.ts`. **Fix:** the
> provenance map plus the three tests above.

---

## 9 — The UI

> **Finding 9.1 — hydration error #418 on `/tiktok` is pre-existing, not from #944.**
> Severity: *cosmetic*. `components/dashboard/tiktok-campaign-library.tsx:744–752` —
> `formatDate` calls `new Date(iso).toLocaleDateString("en-GB", {…, hour, minute})` in a
> `"use client"` component rendered at `:451` and `:572`, so the server formats in the
> deployment's zone and the browser re-formats in the user's; the file was last touched
> in #825 and #821 and is unchanged by #944, whose only edit to `app/(dashboard)/tiktok/page.tsx`
> was adding `<TikTokImportButton />` (a `useState` toggle with no date). **Fix:**
> format with a fixed `timeZone` or render the date in a `useEffect`-gated client-only
> slot.

---

## 10 — PR sequence

Three steps, not four. The order holds; the contents of PR 1 change.

### PR 1 — `cursor/tiktok-import-capture` (amend `pr-944-live-capture-2026-09-15.md`)

Keep A, B, C, D. Amend as follows.

- **A (raw capture route) — confirmed, one addition.** It must record the request
  *and the error body* per call, because the accepted-field list only exists in an
  error, and because `readTikTokLiveCampaign` now throws early
  (`readers.ts:453–462`, `readers.ts:484–492`). The note already says "return what was
  captured up to the throw plus the error" — keep that wording, it is the whole point.
- **B (`connection_type` out) — confirmed, widened.** Do not remove one name; validate
  all 36 against the captured list (Finding 1.3). TikTok adjudicates one index per
  request, so indices 33–35 are still unproven.
- **C (a creative with nothing to show throws) — confirmed.** Name the consequence in
  the PR body: between PR 1 and PR 2 the **upgraded Smart+ import will fail loudly for
  every campaign**, because the walk is still at the wrong nesting. That is the correct
  state — a loud failure beats `c8bca9ff…` — but it should be a decision, not a
  surprise.
- **D (absent vs false) — confirmed, extended.** Add the `absent` counters to
  `normalizeImportMeta` defaulting to `null` (Finding 5.2), and use the sentence table
  in §5.
- **E — amend. This is the substantive change to the note.** The `creative_list[]`
  keys are **not unknown**; they are documented at
  <https://business-api.tiktok.com/portal/docs/get-upgraded-smart-ads/v1.3>, and the
  ad-level id is `smart_plus_ad_id`, not `ad_id`. Keep the walk unchanged in PR 1 —
  the discipline is right, and C makes the wrong walk fail loudly — but replace the
  fixture header and PR body text "`creative_list[]` row keys are **unknown**" with the
  documented shape plus the citation, marked *doc-derived, pending live confirmation*.
  The capture's job becomes confirming a documented shape rather than discovering an
  unknown one, which is a much shorter conversation when the envelopes come back.
- **New in PR 1 — the fixture provenance map and its three tests** (§8). It belongs
  here because the accepted-field fixture arrives here and needs somewhere to live,
  and because the test in §8.3 is the one that would have caught `connection_type`.

### Capture

Matas/Claude drive `GET /api/tiktok/campaigns/import/raw` on both campaigns —
`1874233177915634` (manual) and `1876044101888033` (upgraded Smart+) — and return six
verbatim envelopes each. The manual one is the more important of the two: it has never
returned a single row, and it is the round-trip subject.

### PR 2 — mapper rewritten from the real rows

Findings 1.4–1.7, 2.1–2.9, 3.1–3.3, 4.1–4.3. Concretely: retype
`TikTokSmartPlusCreativeRow` from the captured shape; read `ad_configuration` and the
ad-level `*_list` arrays; take creatives from `/ad/get/` and use `/smart_plus/ad/get/`
only to label chosen-ness; join on `video_id` / `tiktok_item_id` and report `unjoined`;
make plausible-default targeting (ages, locations, gender) throw or drop-and-list; and
land the `MUST_MATCH` / `EXPECTED_TO_DIFFER` / `SOURCE_CANNOT_SUPPLY` round-trip test
on `1874233177915634`.

### ~~PR 3 — preflight~~ — not needed

Verified in §6: preflight blocks an asset-less assigned creative three different ways,
including the mixed case that clears the ad-group gate. `lib/tiktok/write/**` stays
frozen. The one preflight nit found (Finding 6.1, the collapsed count) is cosmetic and
is `write/**`; log it, do not open a PR for it in this arc.

### Guards

Read-only audit. Nothing under `lib/tiktok/write/**`, `evaluate.ts`, `apply.ts`,
`gates.ts`, `components/plan/**` was touched. No TikTok calls were made from this
worktree. No migration.
