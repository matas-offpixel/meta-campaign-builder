# Cursor prompt [Cursor, Opus] — Google Search: final URL wiring + Presence geo-targeting default

Copy this entire block into Cursor as a single message. Opus — one is a hard push-blocker (final_url), one is a targeting-quality default.

PREREQUISITE: Phases 1-4 + 3.5 + xlsx-import-fixes merged. Migration 096 applied.

---

## CONTEXT

Two gaps found reviewing the wizard before the LWE smoke-test push:

1. **No final URL field — HARD PUSH BLOCKER.** RSAs require a `final_url` (the landing page clicks go to — for J2 it's the SeeTickets event URL). The `google_search_rsas` table HAS a `final_url` column (migration 096), but: (a) the xlsx parser doesn't extract it, and (b) the wizard has no UI field for it. Without final_url, `adGroupAds:mutate` fails — Google requires final URLs on RSAs. This must be fixed before any push.

2. **Geo targeting should default to "Presence", not "Presence or interest".** Google's default targets people merely *interested* in a location (wasteful for ticketed events — someone in Spain interested in London can't attend). We want "Presence: people physically in / regularly in the location." This is the `geoTargetTypeSetting.positiveGeoTargetType = "PRESENCE"` field on the campaign at push time, plus a wizard toggle defaulting to Presence.

## BUG 1 — final URL (parse + UI + push)

### Parse (`lib/google-search/xlsx-import.ts`)

The Ad Copy tab has the final URL in a metadata row near the top, e.g.:
`Headlines: max 30 chars each · Descriptions: max 90 chars each · Final URL: https://www.seetickets.com/event/junction-2-miss-monique-indo-warehouse/boston-manor-park/3598857`

Extract it: scan the Ad Copy tab's top rows (before the data header) for a cell containing a URL (`https?://...`). Use the first URL found as the plan's default final_url. Apply it to every RSA's `final_url` during `applyAdCopy` (each campaign's RSA gets the same landing URL unless overridden).

If no URL is found in the Ad Copy tab, also check the Overview tab. If still none, leave `final_url` null and emit a `missing_final_url` warning — the wizard will require it before push.

Also: per-campaign final URLs are a future nicety, but v0 = one plan-level final URL applied to all RSAs is fine. The J2 plan uses a single SeeTickets event URL for everything.

### Wizard UI (Ad Copy step + Plan Setup)

- Add a **"Final URL (landing page)"** field. Best placement: Plan Setup step (plan-level default) AND optionally editable per-RSA in the Ad Copy step. Minimum viable: a plan-level "Default final URL" input in Plan Setup that populates every RSA's final_url. Show it prominently — it's required.
- The Ad Copy / RSA editor should show the final_url per ad group (read-only or editable), so the operator can see where clicks land.
- Validation: add a HARD error in the Review step if any RSA has no final_url (or if the plan-level default is empty). "RSA in [ad group] has no final URL — clicks have nowhere to land." Block push.
- final_url format validation: must start with `http://` or `https://`. Soft-warn if it's not https.

### Push adapter (`lib/google-ads/campaign-writer.ts`)

Confirm the adapter already sends `finalUrls: [rsa.final_url]` on the `adGroupAds:mutate` create (the Phase 3 spike included finalUrls). It does — but now that final_url will actually be populated, verify it's read from the rsa row and sent as an array. If final_url is null at push time, the adapter should fail that RSA into the partial-failure bucket with a clear message rather than sending an empty finalUrls (which Google rejects).

## BUG 2 — Presence geo-targeting default

### Schema note
No migration needed — geo targeting is stored in `google_search_plans.geo_targets` (jsonb) + a new plan-level field for the targeting type. Store the presence/interest choice in the existing `geo_targets` jsonb or add it to a plan-level setting. Simplest: add a `geo_target_type` key to the plan (store in the existing jsonb structure or a column-free jsonb field — avoid a migration). Default `"PRESENCE"`.

### Wizard (Targeting & Budget step)
- Add a toggle: **"Location targeting"** with two options:
  - **Presence (recommended)** — "People physically in or regularly in your locations" — DEFAULT
  - Presence or interest — "Also includes people who've shown interest in your locations"
- Default to Presence. Copy should explain why Presence is right for events (people who can actually attend).

### Push adapter
When creating the campaign, set:
```
geoTargetTypeSetting: {
  positiveGeoTargetType: "PRESENCE",   // or "PRESENCE_OR_INTEREST" if operator chose it
  negativeGeoTargetType: "PRESENCE"     // exclude based on presence too
}
```
Default PRESENCE. Read the operator's choice from the plan. Verify the exact v23 field name + enum values (`PRESENCE` / `PRESENCE_OR_INTEREST`) — the INVALID_ARGUMENT logging will catch it if wrong.

Geo locations themselves (London +20%, South East +15%, etc from the plan) are a separate concern — campaignCriterion location targets with bid modifiers. If the adapter doesn't yet push geo location criteria, that's a known v0 gap (the plan's geo_targets jsonb is staged but may not push yet). Confirm current state: does the adapter push location targeting at all, or just create the campaign without geo? If geo isn't pushed yet, note it in the session log as a follow-up — the Presence/Interest TYPE setting still applies to whatever geo gets set (even the account default), so this fix is still valuable. But surface the gap clearly.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/google-search/ lib/google-ads/ components/google-search-wizard/
node --experimental-strip-types --test 'lib/google-search/__tests__/*.test.ts' 'lib/google-ads/__tests__/*.test.ts'
npm run build
```

Tests:
- xlsx import: final URL extracted from Ad Copy metadata row → every RSA gets it
- xlsx import: no URL present → missing_final_url warning, null final_url
- Review validation: RSA with null final_url → hard error blocks push
- Push adapter: RSA with final_url → finalUrls:[url] sent; RSA with null final_url → partial-failure with clear message
- Push adapter: campaign create includes geoTargetTypeSetting.positiveGeoTargetType=PRESENCE by default
- Push adapter: operator chose interest → PRESENCE_OR_INTEREST sent

## NON-NEGOTIABLES

- Branch: exactly `creator/google-search-final-url-and-presence`
- Do NOT add a migration (final_url column already exists; geo_target_type goes in existing jsonb or plan setting without a schema change)
- final_url is REQUIRED for push — Review step must hard-block without it
- Presence is the DEFAULT geo target type
- Don't regress the xlsx-import-fixes PR's RSA/negative parsing

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-google-search-final-url-and-presence.md`. PR title: `feat(creator): Google Search final URL wiring + Presence geo-targeting default`. Document whether geo location criteria are pushed yet (the v0 gap question above).

## AFTER THIS MERGES

Matas re-imports J2 on LWE → confirms final URL populated (SeeTickets link) + Presence default in targeting → sets £1 daily → pushes → verifies in Google Ads that campaigns have final URLs on ads + Presence location setting. This is the last gap before the smoke test passes clean.
