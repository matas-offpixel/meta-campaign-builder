# Creative Intelligence workstream (CR) — addendum to Engine Roadmap v2

**Date:** 2026-08-21 · Companion to `MULTICHANNEL_ENGINE_ROADMAP_V2_2026-08-21.md`.
Runs PARALLEL to phases A–F; dependency map at the end.

## Three principles

1. **Creative identity is established at upload, not inferred at reporting.** The same asset
   becomes different ad IDs with different names on each platform. Today the only joins are
   the naming convention (Artist – Type – number, enforced by #823's duplicate naming) and
   AI tags — both inference. But the wizards SEE the file at upload: fingerprint it there and
   the cross-platform join is deterministic forever. Retroactive linking stays
   name+tag-based and is labelled "inferred".
2. **Creatives are compared exactly like channels: cost per funnel stage.** Hook rate, CTR,
   cost/click, cost/LPV, cost/signup per creative per platform. Same framing as v2's channel
   comparison, so the dashboard teaches one mental model. Per-creative purchases are
   modelled through the funnel, labelled as such — never claimed.
3. **Tags are where learning compounds.** Individual creatives die fast; tag families
   (motion vs still, artist-face vs crowd vs artwork, lineup vs single-artist) persist
   across events. Per-client tag-level aggregates are the "more events → deeper insight"
   engine: n grows every campaign, and the insight is client-specific — the same retention
   moat as funnel benchmarks, applied to creative.

## The unfair advantage

Per-creative SIGNUP attribution is possible for us and not for Northbeam-style tools:
we control the destination URL at launch (stamp `utm_content=<asset_id>`) AND we own the
landing page that receives it. Platform metrics give per-ad reach/clicks; our pages give
per-creative LPVs and signups deterministically. Nobody measuring from outside the site can
do this. It also only pays once ads point at our LPs — another reason Phase B (LP adoption)
is on the critical path.

## Steps

- **CR.0 Tag taxonomy review (with CR.1):** the autotag taxonomy (creative_tags, migration
  061, motion-replacement era) must cover the dimensions recommendations need: asset type
  (motion/still/carousel), content (artist-face/crowd/artwork/lineup/text-led), hook style.
  Review against real tags in prod; extend additively where thin. The tagger already runs
  (ENABLE_AI_AUTOTAG, on since 05-12) — this is taxonomy, not new ML.
- **CR.1 Creative asset registry:** `creative_assets` (id, client_id, storage
  fingerprint/path, family name, tags) + `creative_placements` (asset_id, platform, ad_id,
  event_id, campaign_id). Wizards and bulk-attach register at upload/launch. Backfill
  current actives via name-grouping + tags, provenance="inferred". Can start NOW — no
  funnel dependency.
- **CR.2 Per-creative funnel metrics (with Phase B):** stamp `utm_content=<asset_id>` on
  destination URLs at launch; join platform per-ad metrics via placements; LPV/signup per
  asset from our pages. Normalise per platform: hook rate (Meta 3s / TikTok 2s views ÷
  impressions — comparable within platform, labelled), hold (p100), CTR, then
  cost-per-stage which IS cross-platform comparable.
- **CR.3 Cross-platform creative scorecard:** per family per event/client: spend,
  impressions, hook, CTR, cost/click, cost/LPV, cost/signup by platform; fatigue trend
  (frequency rising while CTR falls over 14d); provenance badges throughout. Extends the
  existing active-creatives surfaces rather than replacing them.
- **CR.4 Tag-level learning (with Phase C):** aggregates per client × tag × stage with n,
  using the SAME shrinkage machinery as funnel benchmarks (tag → client → industry).
  Output sentences like "motion beats still at hook by 32% for this client (n=14
  creatives, 6 events)" with confidence honest at low n.
- **CR.5 Actionable cross-channel recommendations (with Phase E.3):** recommendation rows,
  same pattern as everything else:
  - GAP: "family 'DJ EZ – Artwork Motion' is your best cost/signup on Meta and is not
    running on TikTok" → one-click prefill into the TikTok wizard / bulk-attach. The launch
    layer makes creative recommendations EXECUTABLE — the thing measurement-only tools
    cannot do.
  - FATIGUE: rotate a named family when frequency/CTR trend crosses threshold.
  - BRIEF GUIDANCE at plan time: "your data says motion + artist-face for this audience" —
    tag-level learnings injected where creative is being chosen, before spend.

**Checkpoint CR:** for one client, the scorecard names a best family per platform at
cost/signup level; at least one gap recommendation is executed via one click; its outcome
(did the family hold its performance on the second platform?) is tracked and shown. That
last loop — recommend → act → measure the recommendation itself — is the self-learning
system eating its own output, and it should be visible to the client.

## Dependencies

CR.0/CR.1 → now (wizard-side, independent). CR.2 → with Phase B. CR.3 → after CR.1+CR.2
partial (platform-side metrics alone already useful). CR.4 → with Phase C machinery.
CR.5 → with Phase E. Nothing here blocks phases A–D; everything here compounds them.
