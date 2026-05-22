# Google Search Ad Plan — Pre-Flight Checklist

Run this before importing any J2-style Google Search xlsx into the wizard. Every item here cost real time on the BB/J2 build (2026-05-21) — this is the "don't hit those again" list.

The golden rule: **the wizard's validation is the source of truth, not the spreadsheet's.** The xlsx char-count column lied (showed `90 ✓` for 112-char descriptions). Build to these limits in the sheet, but trust the wizard's Review step for the final word.

---

## Hard limits (Google rejects the ad if broken)

| Field | Limit | Notes |
|---|---|---|
| Headline | **≤ 30 chars** | Count the real string, not the sheet's formula. Include spaces + punctuation. |
| Description | **≤ 90 chars** | Same. The `·`, `–`, `&` all count as 1. |
| Headlines per RSA | **≥ 3** (15 max) | More is better — Google mixes them. Aim for 8-15. |
| Descriptions per RSA | **≥ 2** (4 max) | The one that bit: C4/C5 had only 1 → blocked. Always write at least 2 per campaign. |
| Display path (path1/path2) | ≤ 15 chars each | Optional, but if used, keep short (e.g. "tickets", "london"). |
| Final URL | required, must be `https://` | RSAs without a final URL are rejected. See URL section below. |

**Quick char-check in Sheets:** put `=LEN(A2)` in a column next to each headline/description. Conditional-format red if `>30` (headlines) or `>90` (descriptions). Do NOT manually type "30 ✓" — that's how the wrong counts crept in.

---

## The Ad Copy tab structure (what the parser expects)

The importer reads section-banner rows (`C1 – BRAND: JUNCTION 2`) to assign copy to campaigns, with H/D rows below. This works — keep the structure. But:

- Each campaign banner can appear TWICE (once over headlines block, once over descriptions block). Fine — the parser merges them into one RSA.
- **Every campaign in the Keywords tab needs a matching Ad Copy block.** C7 (RLSA) had keywords/ad-groups but NO ad copy block → 0 RSAs → blocked. If a campaign exists, give it headlines + descriptions.
- Campaign banner names should match the Keywords tab (case/dash differences are tolerated via fuzzy match, but exact is safest).

---

## Final URL

- The parser pulls the URL from the Ad Copy tab's metadata row (`Final URL: https://...`).
- **Put the CORRECT landing page there.** J2's metadata said SeeTickets but the real page was `lwe.events`. Whatever the client actually sends traffic to — confirm it before building.
- One URL for the whole plan is fine (v1 applies it to every RSA). Per-campaign URLs can be overridden in the wizard's Ad Copy step if needed.
- Must be `https://` (http soft-warns; no URL hard-blocks).

---

## Copy content rules

- **Check every factual claim against the brief.** "6,000 capacity" was in the J2 copy but the client didn't want it mentioned — had to strip it from 6 places. Confirm capacity numbers, dates, lineup, ticket claims with the client before writing.
- Avoid hard capacity/number claims unless the client has explicitly approved them.
- Keep the artist/event/date/CTA structure: each campaign should have headlines covering brand, artist(s), venue, date, and a "buy now" CTA.

---

## Targeting & budget (set in the wizard, not the xlsx)

- **Budget is DAILY, not monthly.** The wizard's "Daily £" field is what pushes (Google campaign budgets are daily). The monthly figure from the plan is reference only. Use the bulk-set input to drop one daily value across all campaigns.
- **Geo: type the location, wait for the green ✓.** As you type "london" the wizard resolves it live against Google's geo database and shows "✓ London, England, United Kingdom". Do NOT push until you see that confirmation — it's the difference between targeting London and targeting the whole world.
  - Bid modifier: `+20` = boost London bids 20%. Enter as `+20`, `20`, or `-10`.
  - If a location shows ⚠ (no match), fix the spelling until it resolves.
- **Bidding: Maximise Clicks** (no conversion tracking on the ticketing pages yet). Target CPA / Smart Bidding needs conversion tracking — not available until SeeTickets/LWE pixel is wired.

---

## Negative keywords

- The tab header is `Campaign / Level | Negative Keyword | Match Type | Reason` — the parser reads this shape.
- Scope value `ALL CAMPAIGNS` = shared (plan-level) negative. A campaign name (e.g. `C6 – Genre`) = campaign-scoped.
- Standard negatives to always include: free, free tickets, torrent, youtube, mix, spotify, soundcloud, download, stream, wiki, biography, interview + any competitor venues.

---

## The push (do this last, on a test account first)

1. Review step → **0 hard errors** before pushing. Fix anything red.
2. Confirm the geo ✓ shows the right location.
3. Confirm Daily £ is set on every campaign.
4. **Smoke-test on a non-client account first** (Off/Pixel 793-280-0197 or LWE 324-410-8450) if it's a new plan shape — push, check Google Ads, delete, then push to the real account.
5. Everything pushes **PAUSED**. Review in Google Ads UI, then enable manually when ready.
6. Verify in Google Ads after push: campaigns PAUSED, daily budget, RSAs with the right final URL, Locations tab shows the target location (not "all locations").

---

## If something fails on import

- "No RSA copy" hard errors → check the Ad Copy tab has a banner block for that campaign.
- "RSA has 1 description" → add a 2nd description.
- Description/headline over-limit → trim in the wizard (it shows the real count); the saved edits persist now.
- Geo shows ⚠ → fix the location spelling.
- Save fails → hard-refresh (stale tab is the usual cause), then re-edit.

---

## Known v1 limitations (not your fault if you hit them)

- Per-location bid modifiers push correctly, but only for locations that resolve (✓).
- One landing URL per plan in v1 (per-RSA override available in the Ad Copy step).
- No conversion tracking → Maximise Clicks only, no Target CPA.

---

## Sitelinks — crowd-out strategy

New plans are seeded with **8 default sitelinks** (Tickets, Lineup, Venue Info, FAQ, Set Times, Travel & Parking, The Stages, How to Buy). All default to the plan's landing URL; override per-sitelink in the Ad Copy wizard step.

**Why 8?** Google displays ≤6 sitelinks per ad impression and always prefers campaign-level sitelinks over account-level ones. Providing 8 campaign-level sitelinks fills every display slot, crowding out any pre-existing account-level sitelinks that point to the wrong pages (e.g. LWE's generic "What's On" / "About Us" sitelinks). The Google Ads API v23 offers no per-campaign endpoint to disable account-level sitelink inheritance — the crowd-out approach is the workaround.

**Rules:**
- Keep ≥6 campaign-level sitelinks to guarantee crowd-out (wizard soft-warns below 6).
- Link text ≤25 chars; each description line ≤35 chars (wizard validates — hard error if exceeded).
- After push, verify in **Ads → Assets → Sitelinks** that 8 campaign-level sitelinks appear under the campaign. If the wrong account-level sitelinks still show in preview, manually remove/pause them at the account level.
- For existing plans with only 4 sitelinks (pre-#457), add 4 more in the wizard's Ad Copy step before re-pushing.

---

*Built 2026-05-21 from the J2 Melodic / Black Butter Google Search wizard launch. Update this as the wizard evolves.*
