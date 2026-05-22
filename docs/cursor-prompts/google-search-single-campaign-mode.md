# Cursor prompt [Cursor, Opus] — single-campaign structure mode (C-codes → ad groups)

Copy this entire block into Cursor as a single message. Opus — this changes how plans are structured; the insight is it's mostly a parser regroup, not a schema teardown. Read the "WHY THIS IS SMALLER THAN IT LOOKS" section first.

PREREQUISITE: Phases 1-4 + 3.5 + #448-#452 merged. Wizard pushes live with geo. Migration 096 applied.

---

## GOAL

Add a structure mode that produces **1 campaign with many ad groups** instead of **7 separate campaigns**, for cleaner management of single-event search plans. Each C-code (C1 Brand, C2 Adam Beyer, ...) becomes an AD GROUP inside one campaign. The existing sub-ad-groups (e.g. C2's "Adam Beyer Tickets" + "Drumcode London") are preserved as their own ad groups.

For a £240 single-event plan, 7 campaigns is heavy: 7 budgets, fragmented reporting, siloed spend. One campaign = one budget that flows to the best-performing themes, consolidated reporting, far less management overhead. This is the better structure for single events.

## WHY THIS IS SMALLER THAN IT LOOKS

The data model ALREADY supports this. The schema is `plan → campaigns → ad_groups → keywords/rsas`. A campaign with multiple ad groups is exactly what C2 already is (it has 2 ad groups). The push adapter, wizard UI, and save logic already handle multi-ad-group campaigns.

So the change is NOT a schema migration. It's:
1. **The xlsx parser** — currently creates one `campaign` per C-code. In single-campaign mode, create ONE campaign and turn each C-code into an ad-group grouping.
2. **A structure-mode flag** on the plan so the operator (or default) picks campaign-per-theme vs single-campaign.
3. **Minor push relabeling** — campaign name + ad group names.

That's it. Don't re-architect the schema.

## DESIGN

### Structure mode flag

Add `structure_mode` to the plan: `"campaign_per_theme"` (current behaviour) | `"single_campaign"` (new). Store it on the plan — reuse the existing pattern (a plan column OR the geo_targets-style jsonb wrapper; prefer a real consideration — if adding a column needs a migration, claim the next integer after 096; if it can live in an existing jsonb/settings field without migration, do that). **Default new plans to `single_campaign`** (the better structure), but keep `campaign_per_theme` available.

### xlsx parser change (`lib/google-search/xlsx-import.ts`)

When `structure_mode === "single_campaign"`:
- Create ONE campaign named after the plan/event (e.g. `[J2-MELODIC] Search`).
- Each C-code (C1, C2, ...) and its existing ad groups become ad groups UNDER that single campaign.
- Ad group naming: prefix with the C-code label so they stay identifiable, e.g. `C1 – Brand`, `C2 – Adam Beyer Tickets`, `C2 – Drumcode London`, `C3 – Miss Monique`, etc. The C-code becomes a naming prefix, not a campaign container.
- Keywords + RSAs stay attached to their ad groups exactly as now.
- Negatives: plan-scoped negatives stay plan-scoped (apply to the one campaign). Campaign-scoped negatives (was per-C-code) become... a decision: in single-campaign mode there's only one campaign, so per-C-code negatives can't be campaign-scoped to different campaigns. Convert them to ad-group-level negatives if the schema supports it, OR roll them into the single campaign's shared negative list. Recommend: roll campaign-scoped negatives into the plan/campaign-shared list in single-campaign mode (simplest, and for a single event the distinction rarely matters). Document the choice.
- Budget: ONE campaign budget (the bulk-set £1/day applies to the single campaign, not split 7 ways). In single-campaign mode the per-campaign budget UI collapses to one budget input.

When `structure_mode === "campaign_per_theme"`: parser behaves exactly as today (no regression).

### Wizard UI

- Plan Setup (or Campaigns step): a structure-mode toggle — "Single campaign (recommended for one event)" vs "Campaign per theme (separate budgets)". Default single.
- The Campaigns step rendering adapts: in single-campaign mode, show one campaign with its ad groups nested (the ad groups are the C-codes). In per-theme mode, show the current multi-campaign view.
- Budget: single-campaign mode shows ONE daily budget input for the campaign. Per-theme shows per-campaign.

### Push adapter (`lib/google-ads/campaign-writer.ts`)

The push already walks `plan → campaigns → ad_groups`. In single-campaign mode the plan has ONE campaign with N ad groups — the adapter handles this WITHOUT CHANGES (it already loops campaigns then ad groups). The only consideration: geo + budget are set on the one campaign (already the case). Verify the adapter needs zero changes for single-campaign mode — if the campaign/ad-group loop is already generic, it just works. Confirm + add a test.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/google-search/ lib/google-ads/ components/google-search-wizard/ app/api/google-search/
node --experimental-strip-types --test 'lib/google-search/__tests__/*.test.ts' 'lib/google-ads/__tests__/*.test.ts'
npm run build
```

Tests:
- Parser, single_campaign mode: J2 fixture → 1 campaign, N ad groups (C1, C2-AdamBeyerTickets, C2-DrumcodeLondon, C3...), keywords/RSAs attached to right ad groups
- Parser, campaign_per_theme mode: J2 fixture → 7 campaigns (UNCHANGED from current — regression guard)
- Negatives in single mode: per-C-code negatives roll into the shared list
- Push: single-campaign plan → adapter creates 1 campaign + N ad groups (assert one campaigns:mutate, N adGroups:mutate)
- Budget: single mode → one campaign budget

## NON-NEGOTIABLES

- Branch: exactly `creator/google-search-single-campaign-mode`
- Default new plans to single_campaign, but campaign_per_theme must still work (no regression — existing/imported per-theme plans render + push as before)
- Schema: avoid a migration if structure_mode can live in an existing settings jsonb; if a column is genuinely cleaner, claim the next migration integer after 096 and surface for ops apply
- Don't regress the geo preview (#452), save hotfix (#450), or geo push (#451)
- The push adapter should need MINIMAL changes — if you find yourself rewriting the mutate chain, stop; the campaign→ad-group loop is already generic

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-google-search-single-campaign-mode.md`. PR title: `feat(creator): single-campaign structure mode (C-codes as ad groups)`. Document the negatives-handling decision + whether a migration was needed.

## AFTER THIS MERGES

Re-import the J2 plan in single-campaign mode → one `[UTB0043-New] Search` campaign with ad groups C1 Brand, C2 Adam Beyer Tickets, C2 Drumcode London, C3 Miss Monique, etc. One budget, one set of geo/settings, consolidated. Push to LWE, verify the single-campaign structure in Google Ads.

The existing 7-campaign J2 push on LWE can be deleted (PAUSED, £0) and replaced with the single-campaign version to compare.
