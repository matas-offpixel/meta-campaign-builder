# Performance Max Launcher — Scope & Build Brief

**Date:** 2026-05-22
**Author:** Commercial+Ops (Cowork) — scoping pass
**Status:** Brief for review → Cursor execution arc
**Sibling to:** Google Search wizard (`lib/google-search/`, PRs #443–#458)

---

## 1. Why this exists

The Search wizard proved the pattern: **client plan (xlsx) → Off/Pixel template → app-generated draft campaign → review → push PAUSED → reporting via `[event_code]`.** PMax is the next surface on the same chassis. It widens the product two ways that matter for the £20k target and the diversification goal:

- **Ticketing clients** (J2, LWE etc) get a second Google surface — PMax mops up YouTube, Display, Discover, Gmail and Maps inventory that Search can't reach, from the same source plan.
- **Brand/awareness clients** (the BB26-KAYODE vertical, future fashion/product brands) get a launcher at all — PMax is the natural awareness+conversion hybrid, and this is the move away from pure event marketing.

**Locked scope decisions (from scoping Q&A, 2026-05-22):**

1. **General-purpose** — serves ticketing AND awareness. Campaign behaviour branches on `event.kind` the way the awareness reporting template already does (`brand_campaign` vs ticketing). Regression-protect both, like the awareness branch protection rule.
2. **One asset group per C-code** — mirrors the Search single-campaign structure: each C-code theme (artist / genre / venue) becomes an **asset group** under one PMax campaign. Familiar to the operator, maps 1:1 from the existing xlsx shape.
3. **Manual asset upload per plan (v1)** — operator uploads images/logos/video into the wizard per campaign. **Defer** creative-library/Bannerbear integration to v2. This is the single biggest scope-saver — see §6.
4. **Full parity with the Search wizard** — xlsx import, review step, geo, asset-group editor, push PAUSED, reporting. Multi-PR arc.

---

## 2. The hard truth: PMax is a SIBLING, not a clone

Reusing the chassis is right, but do not assume the data model copies over. Search is flat and explicit (keywords → ad groups → RSAs). PMax throws most of that out. The differences are load-bearing:

| Concept | Search wizard | Performance Max |
|---|---|---|
| Targeting unit | Keywords (manual) | **None.** No keywords. Google's algo targets. |
| Structure unit | Ad group + RSAs | **Asset group** (bundle of text + image + video assets) |
| "Audience" | n/a | **Audience signals** — *hints*, not targeting. `assetGroupSignals` (search themes + audience lists) |
| Creative | RSA: 15 headlines / 4 descriptions | Asset group: 3-15 headlines, 1-5 long headlines, 2-5 descriptions, **images in 3 aspect ratios**, logo, optional video, business name |
| Bidding | Maximise Clicks (no conv tracking) | **Maximise Clicks is NOT valid for PMax.** Requires MAXIMIZE_CONVERSIONS or MAXIMIZE_CONVERSION_VALUE → **needs conversion tracking** (see §7 — this is a blocker for ticketing) |
| Negatives | Per-campaign / shared | Account-level only (brand exclusions per-campaign via brand lists) |
| Sitelinks | Campaign assets, 8 defaults | Same `campaignAssets:mutate` mechanism — reusable |
| Push API | `adGroups` + `adGroupAds` + `adGroupCriteria` | `assetGroups` + `assets` + `assetGroupAssets` + `assetGroupSignals` |

**Implication:** the chassis layers we reuse are the *outer* ones (xlsx parse loop, plan/status model, review UI shell, geo resolution, sitelink attachment, `[event_code]` reporting, the `GoogleAdsClient.mutate()` primitive, the diff-aware save/idempotency contract). The *inner* data model (`lib/pmax/types.ts`, the asset-group editor, the push fan-out) is new.

---

## 3. Data model (new tables)

Mirror the Search naming so reporting + ops tooling stay legible. New migration set (claim the next integer at build time — latest is `098`; **run `ls supabase/migrations/ | tail -1` and bump** per the universal invariant).

```
pmax_plans            (≈ google_search_plans: id, user_id, event_id, google_ads_account_id,
                       name, status, total_budget, bidding_strategy, conversion_action_id,
                       geo_targets jsonb, date_range jsonb, final_url, pushed_at, structure_mode,
                       created_at, updated_at)
pmax_campaigns        (≈ google_search_campaigns: plan_id, code, name, pushed_resource_name)
pmax_asset_groups     (the C-code unit: campaign_id, code, name, final_url, path1, path2,
                       pushed_resource_name)
pmax_assets           (asset_group_id, kind ENUM[headline|long_headline|description|business_name|
                       marketing_image|square_image|portrait_image|logo|landscape_logo|youtube_video],
                       text, asset_url, pushed_resource_name)
pmax_audience_signals (asset_group_id, signal_type ENUM[search_theme|audience], value,
                       pushed_resource_name)
pmax_sitelinks        (reuse google_search_sitelinks shape if cleaner to share; otherwise mirror)
```

**Reuse, don't fork, where the contract is identical:** geo targets jsonb codec (`lib/google-ads/geo-target-constants.ts`, `geo-resolve.ts`), the sitelink asset/attach path (`prepareSitelinkAssets` + `linkSitelinksToCampaign` in `campaign-writer.ts`), and the `[event_code]` campaign-name prefix (`prefixCampaignName`) so the rollup picks PMax up for free.

---

## 4. The push adapter (`lib/pmax/campaign-writer.ts`)

Mirror the sequential, fatal-on-failure-WITH-cleanup chain in `lib/google-ads/campaign-writer.ts` (`pushGoogleSearchPlan` → `pushSingleCampaign` → fan-outs). The PMax mutate order (v23, all created **PAUSED**):

1. `campaignBudgets:mutate` — daily budget (poundsToMicros, reuse).
2. `campaigns:mutate` — `advertisingChannelType: PERFORMANCE_MAX`, link budget, bidding strategy, **PAUSED**, EU political-ads declaration (same v23 requirement that bit the Search write spike).
3. `campaignCriteria:mutate` — geo (reuse `buildGeoCriterionOp` + `pushCampaignGeoCriteria` wholesale).
4. **Per asset group:**
   a. `assets:mutate` — create every text asset + upload every image/video asset, collect resource names. (Image upload = `assets:mutate` with `imageAsset.data` base64; this is new vs Search — see §6.)
   b. `assetGroups:mutate` — create the asset group, link to campaign, **PAUSED**, set `finalUrls`.
   c. `assetGroupAssets:mutate` — link each asset to the group with its `fieldType` (HEADLINE / LONG_HEADLINE / DESCRIPTION / BUSINESS_NAME / MARKETING_IMAGE / SQUARE_MARKETING_IMAGE / LOGO / YOUTUBE_VIDEO). **partialFailure: true** like the RSA fan-out.
   d. `assetGroupSignals:mutate` — attach search themes + audience signals.
5. Sitelinks — reuse `campaignAssets:mutate` SITELINK path.

**Idempotency contract — copy it exactly.** Diff-aware save keys off `pushed_resource_name` at every level (the load-bearing fix from PR #447 / Phase 3.5). Anything with a marker is skipped on re-push; null markers get created. This is what just saved us on the RSA-bleed re-push — do not regress it for PMax.

---

## 5. Asset minimums = the new "RSA caps"

Google **hard-rejects** an asset group that doesn't meet minimums. This is the PMax equivalent of the 15/4 RSA caps that just cost us three failed pushes — so build the guard in at parse time AND in the push adapter (defence in depth, exactly the pattern in `docs/cursor-prompts/fix-single-campaign-rsa-bleed.md`):

| Asset type | Min | Max | Char limit |
|---|---|---|---|
| Headline | 3 | 15 | 30 |
| Long headline | 1 | 5 | 90 |
| Description | 2 | 5 | 90 (one ≤60) |
| Business name | 1 | 1 | 25 |
| Logo (1:1) | 1 | 5 | — |
| Landscape logo (4:1) | 0 | 5 | — |
| Marketing image (1.91:1) | 1 | 20 | — |
| Square image (1:1) | 1 | 20 | — |
| Portrait image (4:5) | 0 | 20 | — |
| YouTube video | 0 (auto-gen if 0) | 5 | — |

**Parse-time validation** (`lib/pmax/validation.ts`, mirror `google-search/validation.ts`): block save / warn if any asset group is under minimum or over char limit. Emit warnings like `pmax_assets_below_minimum`, `pmax_headline_too_long`, `pmax_missing_image_ratio`. Dedupe text assets case-insensitively (same Google "duplicated across operations" trap).

**Boston Manor Park rule still applies** — strip any capacity number from PMax headlines/descriptions/long-headlines for J2/Boston Manor Park events; use scarcity language. (See `feedback_boston_manor_park_no_capacity_claim.md` — applies across all platforms, this one included.)

---

## 6. Images & video — the part with no Search precedent

This is the genuinely new build surface. Search was text-only. PMax needs binary assets in specific ratios.

**v1 (manual upload):**
- Wizard asset-group step has an upload zone per ratio (1.91:1, 1:1, 4:5 optional; logo 1:1; optional YouTube URL).
- Store uploads in Supabase Storage (reuse the `campaign-assets` bucket pattern from PR #462, or new bucket `pmax-assets` if isolation needed; RLS per user). `pmax_assets.asset_url` points at the storage object.
- **Upload path de-risked by PR #462** (2026-05-26): the Supabase-Storage-bypass-Vercel-4.5MB-limit pattern is now proven and tested for both images (≤30 MB Meta limit, but Google PMax caps at 5 MB per image — enforce client-side) and video. Reuse `uploadAssetViaStorage` from `lib/hooks/useUploadAsset.ts` — extracted as an exported standalone function for exactly this kind of reuse.
- At push, fetch the object from Supabase Storage, base64-encode, send via Google `assets:mutate` `imageAsset.data`. **Validate dimensions + aspect ratio + file size (<5MB Google PMax) client-side before save** — Google rejects off-ratio images and it's a slow round-trip to discover at push.
- YouTube video = just a video ID/URL string → `youtubeVideoAsset`. No upload, Google pulls it.

**v2 (deferred):** wire to the creative library / Bannerbear so asset groups auto-populate from tagged creatives. Out of scope now — flagged so the v1 schema doesn't paint us into a corner (hence `asset_url` not a blob column).

---

## 7. ⚠️ The ticketing blocker you need to know before building

**PMax cannot run on Maximise Clicks.** It requires conversion-based bidding (MAXIMIZE_CONVERSIONS / _VALUE), which requires **conversion tracking on the ticketing pages** — which we explicitly *don't have yet* (the SeeTickets/LWE pixel isn't wired; it's why Search v1 is Clicks-only).

Two consequences:

1. **For ticketing clients, PMax is blocked until conversion tracking exists.** The launcher can build/store/validate the plan, but the push will either fail or run blind without a conversion action. **Do not promise ticketing PMax until the pixel is live.** This is the same dependency that gates the MoS attribution product and the real-reconciliation dark build.
2. **For awareness/brand clients, this is less of a blocker** — brand PMax can use MAXIMIZE_CONVERSIONS against a soft conversion (e.g. a sitewide engagement or a lead form), or you accept it's optimising toward a proxy. Awareness is where PMax v1 actually ships usefully first.

**Recommendation:** sequence the build so **awareness PMax ships first** (no pixel dependency, fits the diversification goal, lower policy risk — and note PMax for ticketing also hits the same Google ticket-seller certification gate you're appealing right now). Ticketing PMax follows once conversion tracking lands. The general-purpose data model supports both from day one; only the *push enablement* gates per `event.kind` + pixel presence.

---

## 8. Phased build plan (the Cursor arc)

Mirrors the Search arc shape. Each phase = one PR, session log per the convention, `creator/` branch prefix (this is Campaign Creator surface).

- **Phase 0 — write spike** `creator/pmax-write-spike`. Prove `assetGroups:mutate` + `assets:mutate` (incl. one image upload) + `assetGroupAssets:mutate` + `assetGroupSignals:mutate` push a valid PMax campaign PAUSED on the LWE test account (or Off/Pixel 793-280-0197). Mirror `docs/GOOGLE_ADS_SEARCH_WIZARD_SCOPE` write-spike. **De-risks the unknown (image upload) before committing to the full arc.** [Cursor, Opus]
- **Phase 1 — data model** `creator/pmax-data-model`. Migration set (§3), `lib/pmax/types.ts`, Supabase Storage bucket. [Cursor, Sonnet]
- **Phase 2 — xlsx import + validation** `creator/pmax-xlsx-import`. Parser (mirror `xlsx-import.ts` C-code carry-forward — and **inherit the fixed boundary logic** from the RSA-bleed fix so PMax doesn't re-introduce the bleed), asset-minimum guard (§5). [Cursor, Opus — parser is where bugs live]
- **Phase 3 — wizard UI shell** `creator/pmax-wizard-ui`. Steps: plan-setup, campaigns, asset-groups (with upload zones §6), audience-signals, targeting-budget, review, push. Reuse geo live-preview + sitelink step. [Cursor, Sonnet]
- **Phase 4 — push adapter** `creator/pmax-push-adapter`. §4 mutate chain + cap/dedupe backstop + diff-aware idempotency. [Cursor, Opus]
- **Phase 5 — reporting** `creator/pmax-reporting`. Verify rollup picks PMax up via `[event_code]` (should be near-free if prefix reused); add asset-group-level insight read. Branch behaviour on `event.kind` for awareness vs ticketing. [Cursor, Sonnet]

**Universal invariants apply:** claim next migration integer at build time; merge migration PRs before dependent code PRs (~90s between); Ops thread lands any `lib/types.ts` / `CLAUDE.md` / schema edits the other threads surface.

---

## 9. Open questions for the next session

1. **Conversion tracking** — is the SeeTickets/LWE pixel anywhere on the roadmap, or do we treat ticketing PMax as permanently gated until the attribution product lands? (Decides whether ticketing PMax is "Phase 6" or "someday".)
2. **First test client** — awareness PMax wants a real brand to validate against. BB26-KAYODE? A fashion-brand prospect? Need one to shape the asset-group defaults.
3. **Audience signals source** — do we hand-author search themes per plan, or pull from the Meta/Google audience work already done? (Affects whether Phase 3's signal step is freeform or library-backed.)
4. **xlsx template** — PMax source plan needs a new tab shape (asset groups + asset lists + signals, no keywords). Worth designing the operator-facing template alongside Phase 2 so the parser and the sheet co-evolve, like the corrected J2 Search template.

---

*Next step: review this brief, confirm the awareness-first sequencing (§7) and the four open questions (§9), then I draft the Phase 0 write-spike Cursor prompt.*
