# Cursor prompt [Cursor, Opus] — Google Search Wizard Phase 1: data model + xlsx import

Copy this entire block into Cursor as a single message. Opus — this defines schema that 3 downstream phases depend on; get the shapes right.

---

## GOAL

Build the data model for the Google Search Campaign Creator wizard, plus an xlsx-import path that parses Matas's existing plan format (like `J2_Melodic_Google_Search_Ad_Plan.xlsx`) straight into the tables. This is Phase 1 of a 4-phase build — Phase 0 (write spike) is done, `GoogleAdsClient.mutate()` is proven and live (PR #442).

Read first: `docs/GOOGLE_ADS_SEARCH_WIZARD_SCOPE_2026-04-30.md` and `docs/session-logs/pr-442-creator-google-ads-write-spike.md` (the launch contract + v23 gotchas).

## CONTEXT

```bash
git checkout main && git pull --ff-only
git checkout -b creator/google-search-wizard-data-model
ls supabase/migrations/ | tail -3   # confirm next integer — should be 096
```

Migration head per Supabase: latest integer is `095_meta_custom_audiences_lookalike_subtype`. Claim **096**. If `ls` shows a higher integer already taken, bump accordingly.

Read for patterns to mirror:
- `supabase/migrations/058_tiktok_campaign_drafts.sql` — precedent for a platform campaign-draft table with RLS-per-user
- `supabase/migrations/062_tiktok_write_idempotency.sql` — idempotency precedent (Phase 3 will need this; reference it for the schema shape now)
- `lib/types.ts` — where `CampaignDraft` (the Meta wizard root state) lives. Mirror the discriminated/nested shape conventions.
- `lib/db/drafts.ts` and `lib/db/templates.ts` — CRUD pattern for campaign drafts
- The reference xlsx is at the path Matas uploaded; its 5-tab structure (Overview / Keywords / Ad Copy / Budget Phasing / Negative Keywords) is the canonical import shape. Column structure documented in the scope doc.

## MIGRATION 096 — `google_search_plans.sql`

Create these tables, all with RLS per `auth.uid()` (mirror the TikTok draft tables' RLS exactly):

```sql
-- Top-level plan, one per event (or standalone)
create table google_search_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  google_ads_account_id uuid references google_ads_accounts(id) on delete set null,
  name text not null,
  status text not null default 'draft' check (status in ('draft','pushed','partially_pushed','archived')),
  total_budget numeric(12,2),
  bidding_strategy text not null default 'maximize_clicks'
    check (bidding_strategy in ('maximize_clicks','manual_cpc')),
  -- geo + date range stored as jsonb for flexibility
  geo_targets jsonb default '[]'::jsonb,        -- [{location, bid_modifier_pct}]
  date_range jsonb,                              -- {since, until}
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table google_search_campaigns (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references google_search_plans(id) on delete cascade,
  name text not null,                            -- auto-prefixed [event_code] at push time
  priority text,                                 -- MUST-RUN / HIGHEST / etc (free text)
  monthly_budget numeric(12,2),
  daily_budget numeric(12,2),                    -- derived or set
  bid_adjustments jsonb default '{}'::jsonb,     -- {device, schedule, geo overrides}
  notes text,
  sort_order integer not null default 0,
  -- populated at push time
  pushed_resource_name text,
  created_at timestamptz not null default now()
);

create table google_search_ad_groups (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references google_search_campaigns(id) on delete cascade,
  name text not null,
  default_cpc numeric(8,2),
  sort_order integer not null default 0,
  pushed_resource_name text,
  created_at timestamptz not null default now()
);

create table google_search_keywords (
  id uuid primary key default gen_random_uuid(),
  ad_group_id uuid not null references google_search_ad_groups(id) on delete cascade,
  keyword text not null,
  match_type text not null check (match_type in ('EXACT','PHRASE','BROAD')),
  est_cpc_low numeric(8,2),
  est_cpc_high numeric(8,2),
  intent text,                                   -- Brand / Trans. / Disc. (free text, drives colour-coding)
  notes text,
  pushed_resource_name text,
  created_at timestamptz not null default now()
);

create table google_search_negatives (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references google_search_plans(id) on delete cascade,
  -- scope: 'all' = all campaigns (shared list), or a specific campaign_id
  campaign_id uuid references google_search_campaigns(id) on delete cascade,
  keyword text not null,
  match_type text not null check (match_type in ('EXACT','PHRASE','BROAD')),
  reason text,
  pushed_resource_name text,
  created_at timestamptz not null default now()
);

create table google_search_rsas (
  id uuid primary key default gen_random_uuid(),
  ad_group_id uuid not null references google_search_ad_groups(id) on delete cascade,
  headlines jsonb not null default '[]'::jsonb,  -- [{text, pin_position?}]  max 30 chars each
  descriptions jsonb not null default '[]'::jsonb, -- [{text, pin_position?}] max 90 chars each
  final_url text,
  path1 text,                                    -- display URL path, max 15 chars
  path2 text,
  pushed_resource_name text,
  created_at timestamptz not null default now()
);
```

RLS: every table gets per-user policies. For child tables (campaigns, ad_groups, keywords, negatives, rsas), the policy joins up to `google_search_plans.user_id = auth.uid()`. Mirror exactly how the TikTok draft child tables do this.

Add `updated_at` trigger on `google_search_plans` (reuse existing trigger function if one exists in the repo; grep for `set_updated_at` or similar).

Add indexes: `google_search_campaigns(plan_id)`, `google_search_ad_groups(campaign_id)`, `google_search_keywords(ad_group_id)`, `google_search_negatives(plan_id)`, `google_search_rsas(ad_group_id)`.

`notify pgrst, 'reload schema';` at the end.

## TYPES — `lib/types.ts` or a new `lib/google-search/types.ts`

Define TypeScript interfaces matching the tables: `GoogleSearchPlan`, `GoogleSearchCampaign`, `GoogleSearchAdGroup`, `GoogleSearchKeyword`, `GoogleSearchNegative`, `GoogleSearchRsa`. Plus a composite `GoogleSearchPlanTree` that nests campaigns → ad_groups → (keywords + rsas) and plan-level negatives, for the wizard to load/render in one shape.

NOTE: per the 4-thread invariant, only the Ops thread edits `lib/types.ts` root. Put the new types in a NEW file `lib/google-search/types.ts` to avoid the shared-file rule. Import from there.

## CRUD — `lib/db/google-search-plans.ts`

Mirror `lib/db/drafts.ts`:
- `createGoogleSearchPlan(supabase, input)` 
- `loadGoogleSearchPlanTree(supabase, planId)` — single round-trip-ish load of the full nested tree
- `saveGoogleSearchPlanTree(supabase, tree)` — upsert the tree (used by wizard autosave)
- `listGoogleSearchPlansForEvent(supabase, eventId)`
- `deleteGoogleSearchPlan(supabase, planId)`

Use the 1,000-row pagination guard if any list could exceed it (per memory `project_supabase_1000_row_pagination`).

## XLSX IMPORT — `lib/google-search/xlsx-import.ts`

This is the high-leverage piece. Matas builds plans in xlsx (the J2 Melodic file). Parse that format into a `GoogleSearchPlanTree`.

The xlsx has 5 tabs:
- **Overview** — strategy metadata + campaign summary table (campaign / focus / ad groups / monthly budget / priority / notes)
- **Keywords** — campaign / ad group / keyword / match type / est cpc / intent / notes / neg keywords
- **Ad Copy** — campaign / type (H1-H15, D1-D4) / content / char count — the RSA library
- **Budget Phasing** — period-by-campaign budget grid
- **Negative Keywords** — campaign-or-level / negative keyword / match type / reason

Use the `xlsx` package (already a dependency — check package.json). Parse defensively: the headers may shift, match types come as `[Exact]` / `"Phrase"` (strip brackets/quotes → EXACT/PHRASE), char-count cells like `30 ✓` should be ignored (recompute char counts ourselves).

Build a parser that:
1. Reads Keywords tab → campaigns + ad_groups + keywords with match types + intent
2. Reads Ad Copy tab → groups H1-Hn and D1-Dn per campaign into RSA headlines/descriptions
3. Reads Negative Keywords tab → plan-level + campaign-scoped negatives
4. Reads Overview campaign summary → campaign priority + monthly_budget
5. Reads Budget Phasing for daily-budget derivation (optional, can be coarse)

Return a `GoogleSearchPlanTree` ready to insert. Validate: headline ≤30 chars, description ≤90 chars, flag (don't reject) anything over.

Add a route `POST /api/google-search/import` that accepts an uploaded xlsx, runs the parser, creates the plan tree in the DB, returns the plan id. Session-bound auth.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/google-search/ lib/db/google-search-plans.ts app/api/google-search/
node --experimental-strip-types --test 'lib/google-search/__tests__/*.test.ts'
npm run build
```

Tests:
- xlsx parser: feed a fixture mirroring the J2 structure, assert it produces N campaigns, correct keyword count, match types normalized, RSAs grouped, negatives scoped
- match-type normalization: `[Exact]`→EXACT, `"Phrase"`→PHRASE, `Broad`→BROAD
- char validation: headline >30 flagged, description >90 flagged

## NON-NEGOTIABLES

- Branch: exactly `creator/google-search-wizard-data-model`
- Migration claims 096 (verify via ls)
- New types go in `lib/google-search/types.ts` NOT `lib/types.ts` (shared-file rule — Ops thread owns root types)
- RLS on every table, per-user, mirroring TikTok draft tables
- Do NOT touch the mutate() primitive or any reporting code (additive only)
- Do NOT build the wizard UI (Phase 2) or push adapter (Phase 3) — schema + import only
- Diff target: under 600 lines including migration + parser + tests

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-google-search-wizard-data-model.md`. PR title: `feat(creator): Google Search wizard data model + xlsx import (Phase 1)`. Include in body the migration number claimed + the ops checklist (apply migration 096 via Supabase MCP post-merge).

## WHY XLSX IMPORT MATTERS

Matas already produces these plans as spreadsheets. A wizard that requires re-typing 45 keywords + an RSA library into a UI is slower than what he does today. Import-first means: build plan in familiar xlsx → upload → review/tweak in wizard → push to Google Ads. The wizard UI (Phase 2) becomes a review+edit surface over imported data, not a from-scratch data-entry form. This is the time-compression win.
