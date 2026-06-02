# Cursor prompt [Cursor, Opus] — sitelink support in Google Search wizard

Copy this entire block into Cursor as a single message. Opus — new feature across data model + UI + push, plus a Google-specific gotcha (account-level asset inheritance).

PREREQUISITE: Phases 1-4 + 3.5 + #448-#455 merged. Migrations 096 + 097 applied. Single-campaign mode live.

---

## PROBLEM + GOAL

Campaigns pushed by the wizard inherit the LWE account's PRE-EXISTING account-level sitelinks ("What's On", "About Us", etc — added by the advertiser long before, pointing to LWE's general site / other venues). Google Ads auto-associates account-level assets with new campaigns. So J2's ads show sitelinks pointing to the wrong pages.

Two things to fix:
1. **Create J2-specific sitelinks** at campaign level (these override account-level ones for the campaign).
2. **Disable account-level sitelink inheritance** on the pushed campaigns so the wrong inherited ones don't show.

The wizard should auto-generate sensible default sitelinks from the event, all defaulting to the plan's final URL, with per-sitelink URL override.

## DESIGN

### Auto-generated default sitelinks

When a plan is created/imported, seed 4 default sitelinks (the operator can edit/remove/add in the wizard):
- **Tickets** — desc lines e.g. "Secure your place" / "Limited availability"
- **Lineup** — "See the full lineup" / "Artists & stages"
- **Venue Info** — "Boston Manor Park" (or the event's venue) / "Getting there"
- **FAQ** — "Times, age policy & more" / "Everything you need to know"

Each defaults `final_url` to the PLAN's final URL (the LWE event page). Description lines optional. Sitelink text ≤25 chars; each description line ≤35 chars (Google limits — validate).

If the event has a venue name, use it for the Venue Info sitelink text/desc. Keep generation simple — these are starting points, the operator refines.

### Data model (migration 098)

```sql
create table google_search_sitelinks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references google_search_plans(id) on delete cascade,
  link_text text not null,          -- <=25 chars
  description1 text,                 -- <=35 chars
  description2 text,                 -- <=35 chars
  final_url text,                    -- defaults to plan final_url at push if null
  sort_order integer not null default 0,
  pushed_resource_name text,         -- idempotency, mirrors other tables
  created_at timestamptz not null default now()
);
```
RLS join-up to plan owner (mirror the negatives table policy exactly). Index on plan_id. Claim migration 098 (verify `ls supabase/migrations/ | tail -1`).

Add `GoogleSearchSitelink` type to `lib/google-search/types.ts`; extend `GoogleSearchPlanTree` to carry `sitelinks: GoogleSearchSitelink[]`. CRUD in `google-search-plans.ts` loadTree/saveTree include sitelinks (diff-aware save, same pattern — never null pushed_resource_name on update).

### Wizard UI

Add a Sitelinks section (in the Ad Copy step or a small dedicated panel). Each sitelink row: link text (char counter ≤25), description 1 (≤35), description 2 (≤35), final URL (defaults to plan URL shown as placeholder, override optional). Add/remove/reorder. Seed the 4 defaults on new plans.

Validation: Google requires sitelinks in PAIRS effectively — minimum 2 sitelinks to show, recommend 4+. Soft-warn if <2. Hard-block any over-limit text.

### Push adapter — TWO things

1. **Create campaign-level sitelink assets.** After campaign creation, for each sitelink: create an asset (sitelink asset) + link it to the campaign via `campaignAssets:mutate` (assetLink with field_type SITELINK). The exact v23 flow: `assets:mutate` to create the sitelink asset (`sitelinkAsset: { linkText, description1, description2 }` + `finalUrls`), then `campaignAssets:mutate` to associate `{ campaign, asset, fieldType: "SITELINK" }`. Verify the exact shapes — INVALID_ARGUMENT logging will catch field-name errors.
   - final_url per sitelink: use the sitelink's `final_url` if set, else the plan's final_url.
   - partialFailure:true on the sitelink batch.
   - Idempotency: skip if `pushed_resource_name` set (mirror geo).

2. **Disable account-level sitelink inheritance** on the pushed campaign so the wrong inherited account sitelinks don't appear. In Google Ads this is done via a campaign setting / a campaign-level negative asset association, OR by setting the campaign to not use account-level assets for the SITELINK field. Research the v23 mechanism (likely a `campaignAsset` with a specific exclusion, or the `campaign.exclude_account_level_assets` style setting if it exists, OR creating campaign-level sitelinks which take precedence). At minimum: creating campaign-level sitelinks usually causes Google to prefer them over account-level. Confirm whether explicit account-asset exclusion is needed/possible in the API; if not cleanly doable via API, document it as a manual step + surface in the launch summary ("account-level sitelinks may still show — remove them in Google Ads if unwanted").

### Single-campaign vs per-theme
In single-campaign mode, sitelinks attach to the one campaign. In per-theme mode, attach to every campaign. The adapter loops campaigns either way — sitelinks apply per campaign.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/google-search/ lib/google-ads/ components/google-search-wizard/ app/api/google-search/ lib/db/google-search-plans.ts
node --experimental-strip-types --test 'lib/google-search/__tests__/*.test.ts' 'lib/google-ads/__tests__/*.test.ts' 'lib/db/__tests__/*.test.ts'
npm run build
```

Tests:
- Default sitelink generation: new plan seeds 4 sitelinks defaulting to plan final_url
- Sitelink char validation: linkText >25 / description >35 flagged
- saveTree: sitelinks diff-aware, pushed_resource_name preserved on update
- Push: campaign with sitelinks → assets:mutate + campaignAssets:mutate called with SITELINK field type; per-sitelink URL override respected; null URL falls back to plan URL
- Push idempotency: pushed sitelink skipped on re-push

## NON-NEGOTIABLES

- Branch: exactly `creator/google-search-sitelinks`
- Migration 098 (verify next integer); RLS mirrors negatives table
- Sitelink final_url defaults to plan final_url, override per-sitelink
- partialFailure on sitelink batch; idempotency via pushed_resource_name
- Don't regress geo (#451/#452), structure mode (#453), save (#450), or the list page (#455)
- REST only, sequential

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-google-search-sitelinks.md`. PR title: `feat(creator): sitelink support (auto-gen + campaign-level push)`. Document the account-level-inheritance handling (API exclusion vs manual step) + the exact v23 sitelink asset shapes that worked.

## AFTER MERGE

Apply migration 098. Re-open the J2 single-campaign plan → Sitelinks section shows 4 auto-gen defaults pointing to the LWE URL → edit if needed → push → campaign gets J2-specific sitelinks, and the wrong account-level ones are excluded (or flagged for manual removal). Verify in Google Ads Assets tab: sitelinks now point to lwe.events, not LWE's generic pages.

## IF ACCOUNT-LEVEL EXCLUSION ISN'T API-DOABLE

If v23 has no clean way to exclude account-level sitelinks per campaign via API, that's fine — creating campaign-level sitelinks is the main win (Google generally prefers campaign-level over account-level). Document the limitation: the operator may need to manually remove/pause the account-level sitelinks in Google Ads if they still show. Don't block the PR on it.
