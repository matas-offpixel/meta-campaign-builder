# Audit: per-placement asset rendering + strong CTA — alternative payload shapes

**Date:** 2026-06-06  
**Branch:** `cursor/audit-per-placement-bookwow-alternative-shapes`  
**Extends:** PR #571 + PR #572 (`AUDIT_1885396_*`)  
**Question:** Is there ANY Meta API payload that delivers per-placement assets (4:5→Feed,
9:16→Stories/Reels) together with `BOOK_NOW`, for any objective?

---

## TL;DR

1. **Literal `BOOK_NOW` cannot coexist with `asset_feed_spec` in a single creative.** This is a
   hard Meta block (subcode=1885396), reconfirmed across every AFS construction. `BUY_NOW` is
   blocked identically. There is no single-creative AFS path that carries `BOOK_NOW`.

2. **But the user's actual goal IS achievable, via two paths:**
   - **Path A — Separate ad sets per placement.** One ad set locked to Feed placements (4:5
     standard creative + `BOOK_NOW`), one locked to Stories/Reels (9:16 standard creative +
     `BOOK_NOW`). No `asset_feed_spec`, so no CTA block. **Verified end-to-end: placements
     persist on the ads.** This is what Meta's own docs and third-party tools recommend for
     using restricted CTAs with per-placement assets.
   - **Path B — Swap to an AFS-compatible ticketing CTA.** `BUY_TICKETS`, `GET_SHOWTIMES`,
     `ORDER_NOW`, `GET_OFFER` all pass `asset_feed_spec` validation AND persist with the
     per-placement rules intact. `BUY_TICKETS` is semantically *better* than `BOOK_NOW` for
     event ticket sales. Keeps the existing single-creative architecture unchanged.
     **Caveat: Meta's Ads Manager Help Centre lists "Buy tickets" as unavailable for placement
     asset customization. The Marketing API accepted and persisted it, but a live publish +
     review + render test is required before trusting it in production (see §6).**

3. **Four of the five hypothesised shapes were refuted** — two of them only after a
   persistence read-back exposed that `validate_only: success` was a false positive.

---

## Methodology note — validate_only is necessary but NOT sufficient

Two probes in this audit returned `{"success":true}` from `validate_only` but were then proven
NON-FUNCTIONAL by reading the persisted object back:

- **Ad-level placement `targeting`** — accepted by validate_only, but the created ad read back
  with the FULL ad-set placement list; the override was silently dropped.
- **`placement_asset_customization_data`** — accepted by validate_only AND by real creation, but
  the field does not exist (read-back: "nonexisting field"); Meta ignored the unknown param.

**Every "success" below was confirmed by creating the real object (PAUSED) and reading it back.**

---

## Probe results

### Shape 1 — `placement_asset_customization_data` at the ad level → PHANTOM FIELD

```
POST /act_*/ads  placement_asset_customization_data=[{customization_spec, image_hash}]
validate_only → {"success":true}
real create   → {"success":true}, ad id returned
read back     → (#100) Tried accessing nonexisting field
                (placement_asset_customization_data)
creative on ad = the plain 4:5 creative, no per-placement data
```
**Verdict: REFUTED.** The field does not exist. Meta silently ignores the unknown POST param.
There is no ad-level placement asset customization field.

### Shape 2a — Two ads in one ad set, ad-level placement `targeting` → NOT PERSISTED

```
POST /act_*/ads targeting={facebook_positions:[story,facebook_reels],
                            instagram_positions:[story,reels]}
validate_only → {"success":true}
real create   → ad id returned
read back     → ad.targeting.facebook_positions = [feed, story, reels, search, ...ALL]
                ad.targeting.instagram_positions = [stream, story, reels, ...ALL]
```
**Verdict: REFUTED.** Modern Meta inherits ad-set placements; the ad-level placement override
is discarded. (The Aberdeen ad set lists all placements explicitly; ad-level narrowing was
ignored regardless.) Two ads in one ad set would both compete across ALL placements — no
per-placement split.

### Shape 2b — Two ad SETS, each placement-locked, standard creative + `BOOK_NOW` → ✓ WORKS

```
Ad set FEED  : targeting.facebook_positions=[feed], instagram_positions=[stream]
Ad set STORY : targeting.facebook_positions=[story,facebook_reels],
                          instagram_positions=[story,reels]
Ad in FEED  : standard link_data, 4:5 image, call_to_action BOOK_NOW
Ad in STORY : standard link_data, 9:16 image, call_to_action BOOK_NOW

real create (PAUSED), read back:
  FEED  ad.targeting → facebook_positions:[feed],            instagram_positions:[stream]
  STORY ad.targeting → facebook_positions:[facebook_reels,story], instagram_positions:[story,reels]
```
**Verdict: ✓ VERIFIED + PERSISTS.** Per-placement asset delivery with literal `BOOK_NOW`,
no `asset_feed_spec`, no 1885396. Placement locks confirmed on the persisted ads. Objective-
independent (standard creative + BOOK_NOW already proven to pass all objectives in PR #572).

### Shape 3 — AFS with multiple / per-rule CTAs → REFUTED

```
call_to_action_types:["BOOK_NOW","LEARN_MORE"] + asset_customization_rules
  → /adcreatives: "Multiple call_to_action_types assets cannot be applied to rule no. 1"
per-rule call_to_action_label
  → /adcreatives: label structure rejected ("doesn't refer to any asset labels")
```
**Verdict: REFUTED.** AFS customization rules allow exactly one CTA per rule; you cannot scope
`BOOK_NOW` to a single placement via a rule. And even a single-CTA AFS with `BOOK_NOW` hits
1885396 at /ads (PR #571).

### Shape 4 — DCO (asset_feed_spec, no rules) per-asset CTA → REFUTED

PR #571 probe B3 already proved AFS *without* `asset_customization_rules` + `BOOK_NOW` still
fails 1885396. There is no per-image CTA field in `asset_feed_spec`. DCO does not rescue
`BOOK_NOW`.
**Verdict: REFUTED.**

### Shape 5 — Carousel `child_attachments` + `BOOK_NOW` → PASSES, but NOT per-placement

```
object_story_spec.link_data.child_attachments=[{4:5 image, BOOK_NOW},{9:16 image, BOOK_NOW}]
/adcreatives → success ; /ads validate_only → success
```
**Verdict: NOT A SOLUTION.** A carousel renders as multiple swipeable cards within the *same*
placement. It does NOT route the 4:5 asset to Feed and the 9:16 asset to Stories/Reels. It does
not satisfy the per-placement-rendering requirement, even though `BOOK_NOW` is allowed here.

### Bonus — AFS-compatible CTA matrix (the key positive finding)

Same exact production AFS shape (asset_feed_spec + asset_customization_rules), OUTCOME_SALES,
`/ads` validate_only:

```
CTA            /ads result          Button text
─────────────────────────────────────────────────────
BOOK_NOW       ✗ 1885396            (Book Now)        ← blocked
BUY_NOW        ✗ 1885396            (Buy Now)         ← blocked
BUY_TICKETS    ✓ SUCCESS            Buy Tickets       ← ideal for ticketing
GET_SHOWTIMES  ✓ SUCCESS            Get Showtimes
ORDER_NOW      ✓ SUCCESS            Order Now
BOOK_TRAVEL    ✓ SUCCESS            Book Now*  (renders similar to Book Now)
GET_OFFER      ✓ SUCCESS            Get Offer
SHOP_NOW       ✓ SUCCESS            Shop Now          (PR #571)
LEARN_MORE     ✓ SUCCESS            Learn More        (PR #571)
SIGN_UP        ✓ SUCCESS            Sign Up           (PR #572)
```

`BUY_TICKETS` persistence verified: created real creative + ad, read back
`asset_feed_spec.call_to_action_types=["BUY_TICKETS"]`, `optimization_type=PLACEMENT`, both
`asset_customization_rules` intact (story_asset→stories/reels, feed_asset→catch-all). Also
passes OUTCOME_TRAFFIC.

---

## Cross-reference (Meta docs + third-party tools)

- **Meta Placement Asset Customization API**
  (`/docs/marketing-api/dynamic-creative/placement-asset-customization/`): PAC = `asset_feed_spec`
  + `asset_customization_rules` — exactly our `buildMultiPlacementCreative`. Confirms "every
  asset_feed_spec needs more than one customization rule" and that CTAs *can* be customised per
  placement in Ads Manager.

- **Meta Business Help Centre** ("About / Troubleshoot asset customisation for placements"):
  > "You can't use some call-to-action (CTA) buttons even when they are compatible with your
  > objective: These CTAs are unavailable: **Buy tickets** and **Save**."
  > "You can't use some features: **Dynamic creative ads**."

  This is the crucial caveat for Path B: Meta's *Ads Manager* documents Buy Tickets as
  unavailable for PAC — even though the *Marketing API* accepted and persisted it in our probes.
  The two surfaces disagree. Trust the API result only after a live render test.

- **Third-party tooling (Smartly / AdEspresso / Blip / Ryze)** and Meta best-practice guides
  converge on the same two strategies we found:
  1. PAC (single ad, asset_customization_rules) for per-placement assets — with CTA limits.
  2. **Separate ad sets per placement** when you need a CTA that PAC restricts. Quote from a
     2026 placement-customization guide: *"Separate Ad Sets … allows you to use the Buy Tickets
     CTA … but forces the algorithm to manage individual learning phases for each placement."*

  No third-party tool has a secret field. They use exactly Path A or Path B. The "Madgicx/Smartly
  ship BOOK_NOW + per-placement" recollection is consistent with **separate ad sets** (Path A).

---

## Recommendation

**There is no single-creative shape that carries literal `BOOK_NOW` with per-placement assets.**
That specific combination is a hard Meta limitation, on the API and (per the Help Centre) in the
UI too. The achievable goal — per-placement assets + a strong ticketing CTA — has two paths:

### Preferred: Path B (CTA swap) — if it survives a live render test
- Change the multi-placement CTA from `BOOK_NOW` to **`BUY_TICKETS`** (fallback `GET_SHOWTIMES`).
- Zero architecture change. `buildMultiPlacementCreative` stays as-is; only the CTA value differs.
- `BUY_TICKETS` is a better ticketing CTA than `BOOK_NOW`.
- **Required gate before shipping:** publish ONE real ad (not validate_only) with
  `BUY_TICKETS` + AFS, confirm (a) it passes Meta review, (b) the rendered button reads "Buy
  Tickets", (c) the 9:16 asset actually serves in Stories/Reels. The API persisted it, but the
  Help Centre's "unavailable" note means delivery-time stripping is a live risk.

### Robust fallback: Path A (separate ad sets) — if Path B fails the render test
- For dual-aspect uploads, emit TWO ad sets: Feed-locked (4:5 + `BOOK_NOW`) and
  Stories/Reels-locked (9:16 + `BOOK_NOW`), standard creatives, no AFS.
- Literal `BOOK_NOW` preserved, per-placement rendering preserved, verified to persist.
- Cost: more ad sets (budget split + separate learning phases). This is a real structural change
  to the launch pipeline (ad-set fan-out), not a one-liner. Matches what Meta + third-party
  tools recommend for restricted CTAs.

### Not recommended
- Silent CTA substitution to LEARN_MORE/SIGN_UP (Matas rejected; weaker than BUY_TICKETS anyway).
- Carousel (not per-placement). Ad-level targeting (not persisted). DCO/per-rule CTA (refuted).

**Decision for product owner:** try Path B first (cheapest, best CTA) behind a live render test;
fall back to Path A only if Meta strips/ rejects `BUY_TICKETS` at delivery.

---

## Probe ledger (2026-06-06, v23.0, all `/ads` unless noted)

- Account `act_10151014958791885`, page `202868440480679`, IG `17841407313865620`
- Hashes: `c324ec4d…` (1080×1350, 4:5), `f93f1038…` (1080×1920, 9:16)
- Real objects created & deleted: 1 TRAFFIC test campaign + 2 placement-locked ad sets + 2
  BOOK_NOW ads (Path A proof); several AFS/standard probe creatives; 1 BUY_TICKETS creative + ad.
- Persistence read-backs performed on: ad-level targeting (refuted), placement_asset_customization_data
  (refuted), 2-ad-set placements (confirmed), BUY_TICKETS AFS rules (confirmed).
- **Residue:** two standard probe creatives (`1778146320217573`, `2131809197397206`) could not be
  hard-deleted ("in use for existing adverts") because the just-deleted ads still reference them
  pre-purge. No live ads reference them; not serving; Meta garbage-collects post-purge.
