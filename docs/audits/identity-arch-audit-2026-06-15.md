# Architecture Audit — IG identity handling (LWE @ionfestival vs @l_w_e)

- **Date:** 2026-06-15 (investigated 2026-06-16)
- **Branch:** `cc/architecture-audit-ig-identity-2026-06-15`
- **Trigger:** Stop condition. 5 PRs (#596 → #600 → #601 → #602) all failed in prod despite
  passing test plans + code-grep verification. `feedback_layered_fix_pattern`.
- **Scope:** AUDIT ONLY. No code changes. No PR.
- **Test under review:** ad_account `901661116878308`, FB Page `145163125507298` (LWE), operator
  picked `@l_w_e` (`17841400485165463`), `attach_adset` cross-campaign, 4 Junction 2 Innervisions
  campaigns. Relaunch after #602 merge → same `@ionfestival` rejection (code=100 subcode=3858231)
  on all 4 ads.

## Evidence availability

| Source | Status | Impact |
|--------|--------|--------|
| Vercel deployment metadata (MCP) | ✅ available | **Confirmed prod = `f03c83d` (#602)** |
| Vercel **runtime logs** (MCP) | ❌ retention elapsed | June-15 wire payload not retrievable |
| Meta Graph API (MCP) | ❌ server errored | Probes A–D cannot run from here |

Two of the four requested probe sources are blocked. The findings below combine the one hard
fact I could establish (prod commit) with an exhaustive static trace. Where a conclusion needs
live data, it is flagged and the exact one-line capture is specified.

---

## 1. Wire-payload analysis

### Hard fact: prod IS running the #602 code
Production deployment `dpl_Dd6W8EwRgovzaXP98MWGs922GXqF` (READY, target=production) is commit
`f03c83d85a033e386576aaa30e2b33f0390d6847` — the #602 squash-merge. **Hypothesis (a) "the code
we grepped isn't the code running on prod" is RULED OUT by deployment metadata.**

### The wire-truth log line already exists
`createMetaCreative` (`lib/meta/client.ts:1629`) logs every creative POST verbatim:

```1629:1638:lib/meta/client.ts
  console.error(
    "[adcreatives POST]",
    JSON.stringify({
      adAccountId,
      creativeName: payload.name,
      instagram_user_id_in_spec: payload.object_story_spec?.instagram_user_id ?? null,
      instagram_user_id_top: payload.instagram_user_id ?? null,
      has_asset_feed_spec: !!payload.asset_feed_spec,
    }),
  );
```

This is exactly the Phase-1 evidence we want — it states whether `instagram_user_id` is in the
body and where. **It was live on June 15.** Vercel runtime-log retention has since elapsed
(queries for `ig-actor-validator`, `145163125507298`, `launch-campaign`, and `level=error` over
2–7d all return "No logs found"). **Action: capture this exact line on the next launch (retention
is short — pull within minutes).** It is the single decisive data point and removes all remaining
ambiguity.

### Static guarantee of payload shape
`createMetaCreative` passes the payload **straight to `graphPost` with no re-wrap and no field
removal** (`client.ts:1639`). The strict-mode sanitizer (`sanitizeCreativeForStrictMode`,
`creative.ts:1073`) strips only `STRICT_MODE_TOP_LEVEL_STRIPS`, `STRICT_MODE_LINK_DATA_STRIPS`,
and rule-less `asset_feed_spec`; **it never touches `object_story_spec.page_id` or
`object_story_spec.instagram_user_id`.** So **hypothesis (b) "a downstream helper re-wraps/drops
the field" is RULED OUT for the launch route.**

---

## 2. Identity assembly call graph

```
WIZARD (client)
├─ components/steps/creatives.tsx
│   ├─ per-ad IG <Select> onChange ............ writes creative.identity.instagramAccountId
│   │     └─ setPageInstagramOverride(pageId, igId)
│   │           ├─ settings.pageInstagramOverrides[pageId] = igId   (persist via onSettingsChange)
│   │           └─ applyPageInstagramOverrideToCreative → identity.{instagramAccountId,instagramActorId}
│   ├─ PageInstagramOverridesPanel ............ same setPageInstagramOverride path
│   └─ useEffect(activePageIdentity) [L286-336]  AUTO-RESOLVES identity.instagramActorId
│         └─ guarded by pageInstagramOverrides[pageId]; else sets actor = resolved (= @ionfestival)
├─ components/steps/audiences/audiences-step.tsx → onPageInstagramOverride
│   └─ wizard-shell handlePageInstagramOverride [L255-280]  (another write site)
└─ wizard-shell handleLaunch [L365-421]
      ├─ builds igAccountMap (overrides → creative ids → cache)   ← carefully prioritised
      └─ POST /api/meta/launch-campaign { draft, igAccountMap }

LAUNCH ROUTE (server)  app/api/meta/launch-campaign/route.ts
├─ parse: draft = body.draft; clientIgMap = body.igAccountMap   [L189-190]
├─ Phase 0e  applyPageInstagramOverridesToCreatives(launchCreatives, …)   [L709]
│      + existing-post-only operatorOverride pageActorMap seed             [L744-753]
├─ Phase 1.5  pageToIg = overrides ⊕ clientIgMap ⊕ server-fetch            [L1243-1266]
│      └─ ⚠ USED ONLY FOR ENGAGEMENT AUDIENCES — not for creatives
├─ Phase 3  per creative:
│      operatorOverride = draft.settings.pageInstagramOverrides[identity.pageId]  [L2561-2564]
│      re-apply override → identity.{instagramAccountId,instagramActorId}        [L2565-2568]
│      rawIgActorId = identity.instagramActorId ?? instagramAccountId            [L2587]
│      validatedIgActorId = igValidator.validate(raw, {operatorOverrideId})      [L2593]
│            └─ lib/meta/ig-actor-validator.ts  (post-#602: trusts operator pick)
│      buildCreativePayload(creative, { validatedIgActorId })                    [L2603]
│            └─ lib/meta/creative.ts:791 dispatch
│                 ├─ existing_post → buildExistingPostCreative (uses instagramAccountId directly)
│                 ├─ multi-placement → buildMultiPlacementCreative  object_story_spec{page_id, IUID?} + asset_feed_spec  [L627]
│                 ├─ video → buildVideoCreative  object_story_spec{page_id, video_data, IUID?}  [L432]
│                 └─ link → buildLinkCreative   object_story_spec{page_id, link_data, IUID?}    [L369]
│      sanitizeCreativeForStrictMode(payload)  (does NOT touch IUID)
│      createMetaCreative → [adcreatives POST] log → graphPost (verbatim)

BULK-ATTACH ROUTE (server)  app/api/meta/create-creatives-and-ads/route.ts   ← PARALLEL PATH
└─ buildCreativePayload(creative)   [L168]   ⚠ NO validatedIgActorId, NO pageInstagramOverrides
      → instagram_user_id ALWAYS omitted for NEW ads → Meta default IG (@ionfestival)
```

### Structural problems the graph exposes
1. **Two creative-build entry points with divergent identity handling.** The launch route threads
   `validatedIgActorId`; the bulk-attach route (`create-creatives-and-ads:168`) calls
   `buildCreativePayload(creative)` with **no IG argument and no override read at all**. Any NEW-ad
   launch through bulk-attach silently omits `instagram_user_id`. (Not the path in this specific
   test, but the same bug class, unfixed.)
2. **`igAccountMap` is dead weight for creatives.** The wizard builds it with operator overrides as
   top priority and sends it, but the launch route only consumes it in Phase 1.5 (engagement
   audiences). Creative identity reads `draft.settings.pageInstagramOverrides` directly. The
   explicit, carefully-prioritised client signal never reaches the creative.
3. **Identity is written/mutated in ~7 places** (UI dropdown, UI panel, UI auto-resolve effect,
   audiences step, wizard handlePageInstagramOverride, Phase 0e, Phase 3 re-apply) and gated by a
   **validator** that historically could null it. Each PR fixed one site. This scatter *is* the
   layered-fix pattern.

---

## 3. Probe plan (BLOCKED — Meta MCP errored; run manually)

Against ad_account `901661116878308`, page `145163125507298`, IG `17841400485165463`.

- **Probe D (most decisive — read what Meta STORED):**
  `GET /{creativeId}?fields=object_story_spec,asset_feed_spec,effective_instagram_media_id`
  for the failed creatives `869197692292471, 2135778437820338, 1282158053682336, 1553156472811414,
  1364709048887668`. If `object_story_spec.instagram_user_id` (or effective IG) reads `@ionfestival`'s
  id, **we sent / Meta resolved the wrong id** → distinguishes (c) vs (d) immediately.
- **Probe A:** `POST /act_901661116878308/adcreatives?validate_only=true` with
  `object_story_spec={page_id:145163125507298, instagram_user_id:17841400485165463, video_data:{…}}`.
  Accept → field+value valid (bug is upstream/state). Reject → the pair itself is invalid for this account.
- **Probe B:** same but wrapped in `asset_feed_spec` (+ `asset_customization_rules`). Tests whether
  Meta keeps the explicit `instagram_user_id` for placement-customized creatives or auto-replaces it.
- **Probe C:** `instagram_user_id` at **top level** of the creative (not nested). Tests the
  alternative field placement some creative types require.
- **Probe 0 (cheap precondition):** `GET /145163125507298/instagram_accounts` (page token) and
  `GET /act_901661116878308/instagram_accounts` (system token). Confirms whether `@l_w_e` is even
  an ads-eligible actor for this page/account.

---

## 4. ROOT CAUSE diagnosis

### Ruled out by hard/static evidence
- **(a) stale prod code** — prod = `f03c83d` (#602). Confirmed via deployment metadata.
- **(b) downstream re-wrap / strip in launch route** — `createMetaCreative` posts verbatim;
  sanitizer never touches `instagram_user_id`. Confirmed by code read.
- **UI not persisting the override** — both write sites persist to
  `settings.pageInstagramOverrides[pageId]` *and* `creative.identity`. Confirmed by code read.
- **Validator nulling the operator pick** — #602 returns the pick before any list check. Confirmed.
- **buildCreativePayload path inconsistency (within the launch route)** — link/video/multi-placement
  all gate `instagram_user_id` on the same `validatedIgActorId`. Confirmed.

### Two surviving hypotheses (distinguishable by Probe D + the `[adcreatives POST]` log)

**H1 — Meta resolves IG identity server-side from the Page's connected IG, ignoring/overriding
`object_story_spec.instagram_user_id` (most likely; architectural).**
This is the only hypothesis consistent with *all five PRs being individually correct yet prod
still naming `@ionfestival`*. Under EU DMA, for a Page with multiple linked IGs, Meta may bind the
ad to the Page's **primary connected IG** at review/delivery regardless of the `instagram_user_id`
we send — especially for `asset_feed_spec` creatives where identity is expected inside the spec
(Probe B), or where the supplied IG is not an ads-authorised actor for the account (Probe 0). If
Probe D shows `effective_instagram_media_id`/stored IG = `@ionfestival` despite us sending
`@l_w_e`, H1 is confirmed and **no client/route code change can fix it** — the fix is at the Meta
asset layer (authorise `@l_w_e` on the ad account / make it the page's ads identity) and/or
placing the identity where Meta honours it (asset_feed_spec / top-level — Probe B/C).

**H2 — the launched draft's `pageInstagramOverrides` / `identity.pageId` is empty or mismatched at
launch (data/state, not code-path).**
Possible via an autosave/identity-auto-resolve race (the `useEffect` at `creatives.tsx:286-336`
re-sets `instagramActorId` to the auto-resolved `@ionfestival` whenever
`pageInstagramOverrides[pageId]` is not seen), or a `pageId` key mismatch in cross-campaign
attach_adset. If H2 holds, the next launch's `[adcreatives POST]` log shows
`instagram_user_id_in_spec: null` (or the wrong id), and `[launch-campaign] creative … (source:
creative-build-time)` instead of `operator-override`.

**Decisive experiment (do this BEFORE any code):** one launch with the
`[adcreatives POST]` log captured + Probe D on the resulting creative.
- IUID present in spec **and** Meta stored `@ionfestival` → **H1** (Meta-side; rewrite ≠ fix).
- IUID null/wrong in spec → **H2** (state; the rewrite below fixes it).

---

## 5. Rewrite proposal (not a patch)

The architecture is wrong in a way that defeats per-PR fixes, regardless of H1/H2. Target shape:

### 5.1 One identity field, resolved once, on the client
- Add a single authoritative field `creative.identity.instagramUserId` (the id Meta should see).
- Resolve it **exactly once**, when the operator selects (or when auto-resolution runs and the
  operator does not override). Delete the `instagramAccountId` vs `instagramActorId` duality that
  forces every consumer to re-derive `rawIgActorId`.

### 5.2 Delete the validator's null-fallback; server trusts the client verbatim
- The `ig-actor-validator` exists to second-guess auto-resolved guesses, but it has nulled valid
  ids in every prior incident (`project_creator_ig_actor_validated_readd_2026-06-05`). Replace it
  with a **one-time `validate_only=true` probe at launch** that either confirms the id or surfaces
  a hard, actionable error to the operator ("@l_w_e isn't an ads-authorised IG for this account").
  Never silently omit the field and fall back to the page default.

### 5.3 One creative builder, one call site
- Collapse `launch-campaign` Phase 3 and `create-creatives-and-ads` onto a single
  `buildCreativePayload` invocation that always receives the resolved identity. Remove the
  duplicated identity logic from the bulk-attach route.
- Remove Phase 0e / Phase 3 "re-apply override" defense-in-depth and the dead `igAccountMap`
  plumbing — they are compensations for not having a single source of truth.

### 5.4 Put the id where Meta honours it (pending Probe B/C)
- If Probe B shows Meta ignores `object_story_spec.instagram_user_id` for `asset_feed_spec`
  creatives, emit the identity inside `asset_feed_spec` (and/or top-level per Probe C). This is the
  likely real fix if H1 holds at the field-placement level.

### 5.5 If H1 (asset-level) holds
- Code cannot fix it. Add a **preflight gate**: probe each creative's identity with
  `validate_only=true` and block launch with a clear message when the chosen IG is not honoured,
  pointing the operator to the Meta Business Settings fix. Document the asset-config requirement.

---

## 6. Migration plan (current scattered state → target)

**Phase 0 — Instrument & ground-truth (no behaviour change).**
Keep the `[adcreatives POST]` log. Add a `validate_only` echo of the assembled payload to the
launch summary. Run the decisive experiment (§4). Record Probe D for the 5 failed creatives.
*Gate: do not write fix code until H1 vs H2 is settled.*

**Phase 1 — Single identity field.** Introduce `identity.instagramUserId`; `migrateDraft`
backfills it from the best of the existing fields. Builders read only the new field. Old fields
become derived/deprecated. (1 PR, additive.)

**Phase 2 — Single builder / single call site.** Route bulk-attach through the same identity
resolution; delete the duplicate logic in `create-creatives-and-ads`. (1 PR.)

**Phase 3 — Replace validator with a probe-or-fail gate.** Delete the null-fallback; add the
`validate_only` preflight. Remove Phase 0e/Phase 3 re-apply and `igAccountMap` creative plumbing.
(1 PR, behind a flag for rollback.)

**Phase 4 — Field-placement fix (if Probe B/C requires).** Emit identity inside `asset_feed_spec`
/ top-level as Meta honours. Verify with `validate_only` in CI. (1 PR.)

### What we should have audited BEFORE PR #596
1. The `[adcreatives POST]` wire log + Probe D on day one — `feedback_trust_payload_diff_over_recent_merge_premise`.
   Five PRs argued about code that the log/readback would have settled in minutes.
2. `validate_only` to confirm field name *and placement* (object_story_spec vs asset_feed_spec vs
   top-level) — `feedback_validate_only_for_meta_field_bugs`.
3. The full call graph (two builders, dead `igAccountMap`, validator null-exit) — the scatter is
   what made each fix look complete while missing the live path. `feedback_layered_fix_pattern`.
