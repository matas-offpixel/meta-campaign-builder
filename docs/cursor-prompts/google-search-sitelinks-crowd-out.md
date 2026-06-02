# Cursor prompt [Cursor, Sonnet] — bump default sitelinks 4→8 (crowd out account-level)

Copy this entire block into Cursor as a single message. Sonnet — small targeted change to the default-sitelink generator + a doc update.

PREREQUISITE: PR #456 (sitelink support) merged, migration 098 applied.

---

## CONTEXT + WHY

Google Ads v23 has no API to exclude account-level sitelinks per campaign (documented in PR #456's launch-summary warning). The LWE account has pre-existing account-level sitelinks pointing to the wrong pages, and they inherit onto new campaigns.

**Crowd-out strategy (the fix):** Google shows only ~4-6 sitelinks per ad impression, and **campaign-level sitelinks take precedence over account-level**. If we supply enough campaign-level sitelinks, every display slot is filled by ours and Google never reaches for an account-level one. ~8 campaign-level sitelinks reliably crowds out account-level. Google's hard cap is 20/campaign; we want ~8 (more than ever shows at once, enough variety).

So: bump the auto-seeded default sitelink count from 4 to 8.

## CHANGE

Find the default-sitelink generator added in PR #456 (the function that seeds sitelinks on plan create/import — grep for the existing 4 defaults "Tickets", "Lineup", "Venue Info", "FAQ", likely in `lib/google-search/` near the plan-creation or sitelink code).

Extend the defaults from 4 to 8. Suggested set (all default `final_url` to NULL → falls back to plan landing URL, same as the existing 4):

1. **Tickets** — "Secure your place" / "Limited availability"
2. **Lineup** — "See the full lineup" / "Artists & stages"
3. **Venue Info** — "{venue_name or 'The venue'}" / "Getting there"   (already venue-flavoured)
4. **FAQ** — "Times, age policy & more" / "Everything you need to know"
5. **Set Times** — "Stage times & schedule" / "Plan your day"
6. **Travel & Parking** — "How to get there" / "Transport & parking"
7. **The Stages** — "The Bridge & The Woods" / "Two iconic stages"   (generic-ish; for events without named stages, fall back to "Stage info" / "Where it happens")
8. **How to Buy** — "Official tickets only" / "Buy via the box office"

Keep them generic enough to work for any event (the venue one already pulls `venue_name`). Validate against the limits: link_text ≤25 chars, description lines ≤35 chars — TRIM any of the above that exceed (check each: "Travel & Parking" = 16 ✓, "Transport & parking" = 19 ✓, etc — but verify all in a test).

## ALSO

- **Soft-warn threshold:** the existing `sitelinks_below_minimum` soft warning fires at <2. Add a NEW soft warning (or adjust messaging) noting that for accounts with existing account-level sitelinks, 6+ campaign-level sitelinks are recommended to crowd them out. Something like `sitelinks_below_crowd_out` at <6 — informational, not blocking. Keep it light; don't over-engineer.
- **Update the launch-summary warning** from PR #456: instead of just "account-level sitelinks may still appear, remove manually", add: "...or add more campaign-level sitelinks (6+) to crowd them out — campaign-level takes display precedence."
- **Update the pre-flight checklist** (`docs/GOOGLE_SEARCH_PLAN_PREFLIGHT_CHECKLIST.md`) sitelinks note: explain the crowd-out strategy + the 8-default behaviour.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/google-search/ components/google-search-wizard/
node --experimental-strip-types --test 'lib/google-search/__tests__/*.test.ts'
npm run build
```

Tests:
- Default generator produces 8 sitelinks (was 4)
- All 8 default link_texts ≤25 chars, all description lines ≤35 chars (the validation that catches a too-long default)
- Venue Info still pulls venue_name when the event has one
- All 8 default final_url = null (fall back to plan URL at push)

## NON-NEGOTIABLES

- Branch: exactly `creator/google-search-sitelinks-crowd-out`
- Don't regress PR #456 (the sitelink table/push/UI) — this only changes the DEFAULT count + copy
- All 8 defaults must pass the char limits — trim any that don't
- No migration (just more rows seeded by the generator)
- Existing plans with 4 sitelinks aren't retroactively changed (only new plans seed 8) — the operator adds more manually on existing plans if wanted

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-google-search-sitelinks-crowd-out.md`. PR title: `feat(creator): 8 default sitelinks to crowd out account-level`. Note the crowd-out rationale.

## AFTER MERGE

New plans seed 8 sitelinks. For the EXISTING J2 plan (only has 4), the operator either re-imports (gets 8) or adds 4 more manually in the wizard. Either way, push → 8 campaign-level sitelinks fill the display slots → LWE's account-level ones never surface on the J2 ads.
