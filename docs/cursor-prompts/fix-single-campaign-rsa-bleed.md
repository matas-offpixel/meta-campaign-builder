# Cursor prompt [Cursor, Opus] — fix C-code RSA bleed in single-campaign mode + enforce RSA caps

Copy this entire block into Cursor as a single message. Opus — real parser bug confirmed on two live plans; diagnose the carry-forward boundary precisely.

PREREQUISITE: PRs #453 (single-campaign mode), #448 (xlsx parser), #456/#458 (sitelinks) merged.

---

## BUG (confirmed on two live plans)

When importing in **single-campaign mode**, a later C-code's RSA copy BLEEDS into an earlier C-code's ad groups. Two plans hit it:

- **J2xFabric**: C5 ad groups (Techno, House, Venue) ended up with 18 headlines + 9 descriptions each — C5's own 8H/3D PLUS C6's retargeting copy ("Still Thinking? Book Now", "Tickets Selling Fast", "Don't Miss...", etc) appended, plus a duplicate headline.
- **Fragrance (Effy x Mall Grab)**: C5 ad groups got 14H + 6D — same bleed pattern (retargeting copy appended), plus a dup headline ("Mall Grab Open Air London" ×2).

Both failed the push with Google error: **"Assets are duplicated across operations.; Too many."** (Google caps RSAs at 15 headlines / 4 descriptions, and rejects duplicate asset text within one create batch.)

## ROOT CAUSE

The single-campaign restructure (`restructureAsSingleCampaign` in `lib/google-search/xlsx-import.ts`, or wherever PR #453 put it) + the Ad Copy section-banner carry-forward (`applyAdCopy`, from PR #448) interact badly:

The Ad Copy parser uses section-banner rows (`C5 – GENRE: ...`, `C6 – RETARGETING: ...`) to assign H/D rows to the current campaign via carry-forward. The bug: **when a new C-code banner appears, the parser does NOT cleanly close the previous campaign's RSA collection.** So C6's H/D rows get appended onto whatever RSA(s) the previous campaign (C5) owns — especially when C5 was split into multiple ad groups by the single-campaign restructure.

Likely mechanism: in single-campaign mode, all C-codes collapse into ad groups under ONE campaign. The RSA-attachment step ("attach this campaign's RSA to all its ad groups") may be running over a stale/accumulating bucket, or the carry-forward `currentCampaign` reset isn't firing on the banner transition, so C5's ad groups receive C5+C6 copy.

INVESTIGATE precisely:
1. Read `applyAdCopy` + `restructureAsSingleCampaign`. Trace how H/D rows accumulate per campaign and how the RSA gets attached to ad groups.
2. Find where the previous campaign's H/D bucket should be FINALISED when a new banner is detected. Is `currentCampaign` reset? Is the bucket per-campaign-keyed correctly, or is there shared mutable state that accumulates across C-codes?
3. Confirm: does the bug exist in BOTH structure modes, or only single_campaign? (The pushed campaign-per-theme J2 plan earlier had correct per-campaign RSAs, so likely single_campaign-specific — but verify.)

## FIX

1. **Fix the carry-forward boundary** so each C-code's H/D rows attach ONLY to that C-code's ad groups. A new banner must close the previous campaign's collection cleanly. The likely fix: ensure the per-campaign headline/description buckets are keyed strictly by the resolved campaign and never shared/accumulated across banners.

2. **Enforce RSA caps as a hard guard at parse time** (defence in depth, regardless of the bleed fix):
   - Max 15 headlines per RSA — if more, keep the first 15, emit a `rsa_headlines_truncated` warning.
   - Max 4 descriptions per RSA — if more, keep the first 4, emit `rsa_descriptions_truncated` warning.
   - **Dedupe** headlines + descriptions within an RSA (case-insensitive exact-match) — Google rejects duplicate assets. Emit `rsa_duplicate_asset_removed` warning.
   This guard means even if some other path over-fills an RSA, the import never produces an un-pushable RSA.

3. **Same guard in the push adapter** (`campaign-writer.ts`) as a final backstop: before building the adGroupAds:mutate, cap headlines to 15, descriptions to 4, dedupe. So a plan that somehow has an over-cap RSA (e.g. an old plan in the DB from before this fix) still pushes a valid trimmed RSA rather than failing. Emit it in the launch summary if trimming occurred.

## VALIDATION

```bash
npx tsc --noEmit
npx eslint lib/google-search/ lib/google-ads/
node --experimental-strip-types --test 'lib/google-search/__tests__/*.test.ts' 'lib/google-ads/__tests__/*.test.ts'
npm run build
```

Tests — use a fixture mirroring the real bug:
- Ad Copy with C5 banner (8H/3D) immediately followed by C6 banner (retargeting copy) in single_campaign mode → assert C5's ad groups get ONLY C5's 8H/3D, C6's ad groups get ONLY C6's copy. No bleed.
- A campaign block with >15 headlines → parser keeps 15, warns.
- A campaign block with >4 descriptions → keeps 4, warns.
- Duplicate headline within a block → deduped, warns.
- Push adapter: an RSA with 18H/9D in the DB → adapter trims to 15/4 + dedupes before mutate, pushes valid, notes trim in summary.
- Regression: campaign-per-theme mode still attaches RSAs correctly (no change).

## NON-NEGOTIABLES

- Branch: exactly `creator/fix-single-campaign-rsa-bleed`
- Fix the ROOT cause (carry-forward boundary) AND add the caps guard (defence in depth) — both, not just one
- Dedupe is case-insensitive exact match
- Don't regress campaign-per-theme parsing or the sitelink/geo work
- No migration

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-fix-single-campaign-rsa-bleed.md`. PR title: `fix(creator): C-code RSA bleed in single-campaign mode + RSA cap/dedupe guard`. Document the exact carry-forward boundary bug found.

## NOTE — separate issue, NOT in scope here

The Fragrance plan ALSO had 4 keywords rejected by Google for policy violation ("special request" phrase tripping Google's content policy). That's a Google content rejection, not a wizard bug — handled separately by rephrasing the keywords. Do NOT try to "fix" policy-violating keywords in code; that's a content decision.

## AFTER MERGE

Re-import J2xFabric + Fragrance fresh (or the operator re-pushes the DB-patched versions). New imports won't have the C5 bleed. The cap/dedupe guard means even malformed source xlsx produces pushable RSAs.
