# Google Ads Search Campaign Creator — Build Scope

**Date:** 2026-04-30
**Status:** Scoped, not started. Build next session.
**Owner thread:** Creator + Reporting
**Reference plan:** `J2_Melodic_Google_Search_Ad_Plan.xlsx` (Junction 2 Melodic, 26 Jul 2026) — the structure this wizard must be able to produce.

---

## Feasibility verdict

**Yes, buildable.** The reference plan (7 campaigns, 45 keywords, RSA library, 23 negatives, geo + bid adjustments) maps cleanly to Google Ads API mutate operations. Mirrors the existing Meta campaign wizard's draft-then-launch shape.

**Confirmed constraints from Matas (2026-04-30):**
- End goal: app generates a **draft campaign in Google Ads as PAUSED**, reviewed + launched manually
- Write API access: **UNVERIFIED** — tonight only verified read/reporting. Must test mutate ops before committing to full build.
- Conversion tracking: **NOT set up** on SeeTickets. Focus on **clicks** for v1. This removes Smart Bidding / Target CPA / RLSA from v1 scope.

---

## What this simplifies (because no conversion tracking)

The reference plan assumes Target CPA + Smart Bidding + RLSA. Without conversion tracking, none of that works. v1 scope collapses to:

- **Bidding:** Maximise Clicks (or Manual CPC) only. No Target CPA, no Max Conversions.
- **No RLSA** in v1 (needs remarketing audiences + conversion data).
- **No Smart Bidding strategy switching.**
- **Geo + bid adjustments:** still supported (these don't need conversion data).
- **Negative keywords, keyword match types, RSAs:** all fully supported.

This is actually a cleaner v1 than the full plan. Ship clicks-optimised search campaigns, add conversion-based bidding later when SeeTickets tracking (or a different ticketing partner with pixel access) is sorted.

---

## Phase 0 — Write API spike (MUST do first, ~half day)

Before any wizard UI, prove the write path works. This de-risks the whole arc.

**Cursor spike task:**
- Create a throwaway PAUSED campaign on a test sub-account (NOT a client account) via the Google Ads REST API mutate endpoints
- Verify: `campaignBudgets:mutate` → `campaigns:mutate` → `adGroups:mutate` → `adGroupCriteria:mutate` (keywords + negatives) → `adGroupAds:mutate` (RSA)
- Confirm the developer token tier allows writes (Basic Access SHOULD, but verify — some operations need the account out of test mode)
- Document the exact REST request shapes that work — these become the adapter contract

**If writes are blocked:** fall back to "structured plan export" mode (in-app editable plan + Google Ads Editor CSV export) until write access is sorted. Still valuable, much less risk.

**Concurrency:** reuse `GOOGLE_ADS_CHUNK_CONCURRENCY = 1`. Mutate ops are sequential.

---

## Phase 1 — Data model + brief intake (1-2 PRs)

The wizard needs a place to store the plan structure before pushing to Google Ads.

**New tables (migration):**
- `google_search_plans` — top-level plan per event (event_id, status draft/pushed, budget, bidding_strategy, geo_targets, date_range)
- `google_search_campaigns` — campaign rows (plan_id, name, priority, monthly_budget, bid_adjustments jsonb)
- `google_search_ad_groups` — (campaign_id, name)
- `google_search_keywords` — (ad_group_id, keyword, match_type, est_cpc_low, est_cpc_high, intent, notes)
- `google_search_negatives` — (plan_id or campaign_id scope, keyword, match_type, reason)
- `google_search_rsas` — (ad_group_id, headlines jsonb[], descriptions jsonb[], final_url, path1, path2)

Mirror the encrypted-creds + RLS-per-user patterns already established.

**Brief intake:** ideally the xlsx structure (or a simpler brief form) parses into these tables. The reference xlsx is a good template for the column shapes. Consider an xlsx-import path since Matas already builds plans in that format.

---

## Phase 2 — Wizard UI (2-3 PRs)

Mirror the Meta wizard's 8-step shell at a new route `/google-search/[id]` (NOT `/campaign/[id]` which is Meta-only).

Suggested steps:
1. **Plan setup** — event link, Google Ads account (from `google_ads_accounts`), total budget, date range
2. **Campaign structure** — campaigns + ad groups (table editor, or import from xlsx)
3. **Keywords** — per ad group, match types, with the intent colour-coding from the plan
4. **Negatives** — campaign-level + shared list
5. **Ad copy (RSA)** — headline/description editor with the 30/90 char validation (you already do char validation for Meta — reuse)
6. **Targeting + budget** — geo, bid adjustments, budget split per campaign, Maximise Clicks bidding
7. **Review** — full plan summary, char-limit checks, keyword/negative conflict checks
8. **Push to Google Ads** — creates everything PAUSED via the mutate adapter, returns links to Google Ads UI for manual review + launch

Char validation rules: headlines ≤30 chars, descriptions ≤90 chars (already in the plan's Ad Copy tab — those are correct Google limits).

---

## Phase 3 — Push adapter (1-2 PRs)

`lib/google-ads/campaign-writer.ts` — takes a `google_search_plans` row + children, executes the mutate chain, sets everything PAUSED. Returns created resource names + Google Ads UI deep links.

- Idempotency: mirror `tiktok_write_idempotency` (migration 062) pattern so a re-push doesn't duplicate campaigns.
- Error handling: if a mutate fails mid-chain, roll back or mark plan as partially-pushed with clear state. Don't leave orphaned half-campaigns.
- All campaigns created PAUSED — never auto-enable. Human reviews in Google Ads UI then enables.

---

## Phase 4 — Reporting integration (already built)

Once campaigns are live (manually enabled), the reporting layer shipped 2026-04-30 already picks them up via the `[event_code]` bracket matcher. No new reporting work needed — the search campaigns flow into the same Google Ads reporting block. **This is the payoff of building reporting first.**

Caveat: the search campaigns need `[event_code]` in their names for the matcher to scope them. The wizard should auto-prefix campaign names with the event code (e.g. `[J2-MELODIC] C2 Adam Beyer`).

---

## What's explicitly OUT of v1

- Target CPA / Max Conversions bidding (no conversion tracking)
- RLSA audience layering (needs conversion data + remarketing lists)
- Smart Bidding strategy auto-switching
- Conversion tracking setup (SeeTickets/GTM dependency, outside our app)
- Auto-launch (everything stays PAUSED for human review)
- Performance Max / Display / YouTube (search only for v1)

---

## Effort estimate

- Phase 0 (write spike): half day — DO FIRST, gates everything
- Phase 1 (data model): 1-2 PRs
- Phase 2 (wizard UI): 2-3 PRs — biggest chunk
- Phase 3 (push adapter): 1-2 PRs
- Phase 4 (reporting): 0 PRs (already built)

**Total: ~6-9 PRs over 1-2 weeks**, assuming write access is confirmed in Phase 0. If write access is blocked, pivot to export-only mode (~3-4 PRs).

---

## First action next session

Run the Phase 0 write spike in Cursor. Until writes are proven, the wizard is speculative. The spike answers the one question that determines whether this is a 1-week build or a "wait for API approval" hold.

If Phase 0 succeeds → proceed to Phase 1 data model.
If Phase 0 blocked → build the export-only version (in-app editable plan + Google Ads Editor CSV export), which delivers most of the value without write access and is what Matas does manually today anyway.
