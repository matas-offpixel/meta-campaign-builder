# Kick Off Club — Project Instructions

**Date created:** 2026-05-12
**Status:** v1 canonical (supersedes 4thefans-Claude v0 draft)
**Maintenance:** update when client adds venues, changes platforms, or shifts budget/scope

---

## 1. CLIENT PROFILE

**Kick Off Club** — London-based World Cup 2026 fanzone operator.

- **Client lead:** Charlie Holden
- **Host page:** https://kickoffclub.co.uk
- **Stage:** Brand-new onboarding, ads launching WC 11 May 2026
- **Currency:** GBP
- **Contract shape:** Ads-only (not retainer / not dashboard tier)
- **Off/Pixel fee:** £2,570 base across 3 venues for the entire campaign
- **Sell-out bonus:** £0.10/ticket on sold-out fixtures
- **Term:** Through WC final 19 July 2026

**Different from 4thefans:**
- London-only (no regional split logic)
- One venue per event_code, multiple screenings per venue
- Specific fixture list per venue (not "all 64 WC games")
- Skiddle ticketing (no API — manual reporting cadence)
- Ads-only scope — dashboard provided as included value
- No D2C / WhatsApp work
- Brand awareness ambition alongside ticket sales

---

## 2. VENUES + FIXTURES

Three venues, ~17 confirmed fixtures total (per client's Skiddle listings as of 2026-05-12):

### Brixton (Electric Brixton, 1,500 cap) — 5 fixtures
- England vs Croatia · Wed 17 Jun · 7:00pm
- Australia vs USA · Fri 19 Jun · 6:30pm
- England vs Ghana · Tue 23 Jun · 7:00pm
- Scotland vs Brazil · Wed 24 Jun · 9:00pm
- England vs Panama · Sat 27 Jun · 8:00pm

### Hackney Wick (Colour Factory, 800 cap) — 7 fixtures
- France vs Senegal · Tue 16 Jun · 6:30pm
- England vs Croatia · Wed 17 Jun · 7:00pm
- Australia vs USA · Fri 19 Jun · 6:30pm
- Scotland vs Morocco · Fri 19 Jun · 10:30pm
- England vs Ghana · Tue 23 Jun · 7:00pm
- Scotland vs Brazil · Wed 24 Jun · 9:00pm
- (+1 additional fixture per screenshot, TBC)

### Soho (Outernet, 1,300 cap) — 5 fixtures
- France vs Senegal · Tue 16 Jun · 6:30pm
- England vs Croatia · Wed 17 Jun · 7:00pm
- England vs Ghana · Tue 23 Jun · 7:00pm
- Scotland vs Brazil · Wed 24 Jun · 9:00pm
- England vs Panama · Sat 27 Jun · 8:00pm

**Knockout fixtures (R16, QF, SF, Final)** — not yet listed on Skiddle. Will be added once group stages resolve. Client commits 7+ key matches per venue minimum across the run.

**Event code convention:** `WC26-KOC-[VENUE]-[FIXTURE]`
- Example: `WC26-KOC-BRIXTON-ENG-CRO`
- Example: `WC26-KOC-SOHO-FRA-SEN`

---

## 3. TICKETING + REPORTING

**Provider:** Skiddle (no API access).

**Reporting model: Manual weekly.**

- Ask Charlie partner access to Skiddle dashboard (requested 2026-05-12)
- If partner access granted → Matas pulls sales daily from Skiddle UI
- If partner access denied → Charlie sends Friday EOD sales-by-fixture pull (WhatsApp screenshot acceptable)
- Paste into xlsx-import flow at `/api/clients/[id]/ticketing-import`
- Dashboard renders downstream automatically (smoothing + allocator handle the rest)

**No Skiddle API integration build.** £2,570 contract fee doesn't justify 2-day Cursor Opus build cost. Manual cadence is the right call for this engagement.

**Sell-out bonus reconciliation:** pull final sold counts per fixture at event close. £0.10/ticket × sold-out fixtures. Invoice within 7 days of last event in venue.

---

## 4. CAMPAIGN STRUCTURE

### Campaign naming convention (REQUIRED for spend allocator)

`[WC26-KOC-VENUE] {Phase} | {FixtureTag}`

Examples:
- `[WC26-KOC-BRIXTON] Sale | England-Croatia`
- `[WC26-KOC-SOHO] Sale | France-Senegal`
- `[WC26-KOC-HACKNEY] Sale | All Games` (multi-fixture catch-all)
- `[WC26-KOC-BRIXTON] Brand | Followers` (awareness campaigns)
- `[WC26-KOC-SOHO] Retargeting | Group Stage` (mid-funnel)

### Allocator strategy

Hard-code a temporary `[WC26-KOC-*]` branch matching pattern in `lib/dashboard/venue-spend-allocator.ts` until the allocator strategy registry PR lands (queued: Task #73 / Week 2). Once registry lands, migrate to `getAllocatorStrategy(client, event)` returning `equal_split_per_fixture` for catch-all campaigns and `opponent_match` for fixture-specific.

Brand awareness campaigns: use the existing `event.kind = 'brand_campaign'` pattern (per memory `project_creator_awareness_template_shipped_2026-04-30.md`). Do NOT bolt a new "client_level_aware" strategy into the ticketed allocator.

---

## 5. PAID MEDIA BUDGET BANDS

**Total budget:** £10,000–£12,000 across 3 venues for the entire campaign.

### Phasing (per client's "Suggested timeline")

| Week of | Phase | Weight | Notes |
|---|---|---|---|
| 11 May | Launch | Medium | Early interest + first tickets |
| 18 May | Build | Light | |
| 25 May | Pay-day push | **Heavy** | WC squads announced |
| 1 Jun | Pre-launch push | **Heavy** | 1 week before tournament start |
| 8 Jun | Tournament start | **Heavy** | Kick-off 11 Jun |
| 15 Jun | Group stage | Medium | |
| 22 Jun | Group stage | Medium | |
| 29 Jun | Knockouts | Light | Sells naturally |

**Allocation guidance:** 60% of total spend hits the three "Heavy" weeks (25 May / 1 Jun / 8 Jun). Daily budget average across run ~£1,250-£1,500/week.

**Early-week expectation:** ads launching straight to on-sale (no signup/presale build). First 1-2 weeks may track slower than a typical signup campaign. Recovery via pay-day push weeks.

---

## 6. CHANNELS

### Primary: Meta (Instagram + Facebook)

Bulk of budget here. Client confirmed ad account access granted to Off/Pixel (BM-access route — see memory `project_4thefans_bm_access.md`).

### Secondary: TikTok

Client said "open to it." **Hard gate before queuing TikTok work:** client must grant TikTok Business Center access. Use existing TikTok pipeline (memory `project_creator_tiktok_full_pipeline_2026-05-01.md`).

### Tertiary: Google Ads

Client said "Google search is going to be quite big for World Cup." **Hard gate:** Google Ads MCC link request sent to client to connect to 333-703-8088. Use existing Google Ads pipeline (memory `project_creator_google_ads_shipped_2026-04-30.md`). Search campaigns > Display for this client.

### Out of scope

- D2C / WhatsApp comms (different from 4thefans which uses WhatsApp communities)
- SEO content writing

---

## 7. CREATIVE PIPELINE

**Assets shared by client:**
- Artwork (Google Drive): https://drive.google.com/drive/folders/1FyOJ55bIGZMclMzMSyBLJ7Lkt2OqdJaz
- Video creatives (Dropbox): https://www.dropbox.com/scl/fo/xjkolcg5cjnm9cgugy7pq/

**Two creative tracks (don't mix in same campaign):**

| Track | Goal | Creative shape | CTA |
|---|---|---|---|
| Performance | Sell tickets | Fixture-specific, urgency-driven, atmosphere shots | Buy Tickets → Skiddle link |
| Brand awareness | Page growth, audience interaction | Venue identity, repeat customer narrative | Follow / Engage |

Tag separately in the active-creatives system. Performance creatives roll up to ticketed events. Brand awareness creatives roll up to brand_campaign event kind.

**Active creative concept naming:** `[VENUE_CODE] {creative_type} {variant}` — e.g. `[WC26-KOC-BRIXTON] Players UGC v1`. Per memory `project_campaign_naming_convention.md` — bracketed prefix is load-bearing.

---

## 8. ATTRIBUTION MODEL

**Critical difference from 4thefans:** Kick Off Club doesn't own the ticket-purchase funnel. Skiddle is the host; Off/Pixel runs Meta/TikTok/Google ads driving traffic to Skiddle landing pages.

**Attribution chain:**
- Meta ad click → Skiddle event page → ticket purchase
- Off-platform conversions; can't track end-to-end without Skiddle pixel integration

**Three options for measurement:**
1. **Meta Pixel embedded in Skiddle event pages** — confirm with Charlie whether Skiddle exposes Meta Pixel injection for partner clients. Probably not, but worth asking.
2. **Meta on-platform conversion lift modelling** — directional only, not exact ticket counts
3. **Reconcile retrospectively** — Friday manual sales pull is the truth source for what actually sold per venue per fixture. Match against Meta spend per venue per fixture for ROAS picture.

**Default mode:** option 3. Cleaner than mixed signal from option 2.

---

## 9. PRICING

**This engagement: ads-only, £2,570 base + £0.10/ticket sell-out bonus.**

Quote breakdown:
- Outernet (Soho, 1,300 cap): £840
- Colour Factory (Hackney Wick, 800 cap): £750
- Electric Brixton (1,500 cap): £980
- **Total: £2,570** base
- Sell-out bonus: £0.10/ticket × tickets sold on sold-out fixtures (TBD which fixtures sell out)

**Dashboard provided as included value at no extra fee.** Use this campaign to justify Tier 2 pricing on Kick Off Club's NEXT campaign — show Charlie the dashboard during/after Week 1, position as "what you'd be paying £750-1000/mo for on a retainer basis."

---

## 10. DASHBOARD ONBOARDING SEQUENCE

Following the existing 10-step manual onboarding pattern (`docs/DASHBOARD_BUILD_AUDIT_2026-05-09.md`):

- [ ] Create client row in `/clients/new`
  - Name: "Kick Off Club"
  - primary_type: "promoter"
  - meta_ad_account_id: TBD (request from Charlie)
  - tiktok_handle / facebook_page_handle: pull from kickoffclub.co.uk
- [ ] Connect Meta OAuth (BM-access route)
- [ ] Set `clients.meta_ad_account_id` after OAuth
- [ ] Seed event rows manually for ~17 confirmed fixtures (Brixton 5 + Hackney 7 + Soho 5)
- [ ] Skip Skiddle ticketing connection (manual reporting only)
- [ ] First spend sync via cron / manual trigger
- [ ] Set up xlsx-import flow for weekly sales (template at `/api/clients/[id]/ticketing-import`)
- [ ] Internal-only dashboard for Week 1 (verify smoothing + allocator working)
- [ ] Mint share token end of Week 1 once first sales import lands
- [ ] Share dashboard with Charlie + position as included value

**Pre-launch validation (before ad launch Wed/Thu this week):**
- Allocator routes campaigns correctly given the venue-prefix naming convention
- Active creatives card thumbnails load
- Test event row + test campaign in DB doesn't break the rollup

---

## 11. TIMELINE TO LAUNCH-READY

| Day | Task | Tag |
|---|---|---|
| Mon 12 May | Client row + event seeds in DB | manual via Cowork Supabase MCP |
| Mon 12 May | Send fixture commitment + platform access asks to client | email |
| Tue 13 May | Meta ad accounts wired up, first campaign creation | manual via campaign creator wizard |
| Wed 14 May | Ad launch — Meta only, 3 venues × early-week fixtures | client-facing |
| Thu 15 May | Spend monitoring + creative iteration | daily |
| Fri 16 May | First sales pull from Charlie (or Skiddle dashboard) | manual |
| Mon 19 May | Share token to Charlie (Week 1 review) | once data validated |

**Risks:**
- Skiddle partner access not granted → fall back to Friday-only manual pulls
- Meta ad account access not active before Wed → push ad launch to Thu/Fri
- Knockout fixtures not added to Skiddle until late June → seed event rows reactively

---

## 12. EXECUTION TOOLING

Onboarded under the three-tool execution model (`docs/EXECUTION_TOOLING_2026-05-11.md`):

- Prompts tagged `[Claude Code, Sonnet]`, `[Cursor, Sonnet]`, or `[Cursor, Opus]`
- Branches: `cc/creator/koc-*` for Claude Code, `cursor/creator/koc-*` for Cursor
- Verify PR state via GitHub MCP before declaring shipped
- Memory anchors specific to this client: `project_kickoffclub_*.md`

**Most Kick Off Club work will be Claude Code Sonnet:**
- Event row seeding (manual SQL via Supabase MCP)
- Allocator branch addition (small, 1 file)
- xlsx import scripts (small)

**Cursor only if:**
- Allocator strategy registry refactor (waiting on Week 2 PR)
- Major dashboard surface changes (unlikely on this client)

---

## 13. ANCHORS FOR FUTURE SESSIONS

Mandatory reading when working on Kick Off Club:

- `feedback_resolver_dashboard_test_gap.md`
- `feedback_collapse_strategy_per_consumer.md`
- `feedback_snapshot_source_completeness.md`
- `feedback_defensive_json_parse_pattern.md`
- `feedback_new_client_onboarding_via_project_claude.md` — this client used the draft-via-similar-client pattern
- `project_4thefans_dashboard_arc_2026-05-09.md` — canonical reference for the WC pattern (but Skiddle != fourthefans)
- `project_kickoffclub_onboarding_2026-05-12.md` — review summary that produced this v1 doc

---

## 14. OPEN QUESTIONS WITH CLIENT

Still awaiting confirmation from Charlie on:
- [ ] Skiddle partner dashboard access (requested 2026-05-12)
- [ ] TikTok Business Center access grant
- [ ] Google Ads MCC link to 333-703-8088
- [ ] Final fixture list for each venue (especially knockouts)
- [ ] Confirm Meta Pixel injection on Skiddle event pages is/isn't available

---

End of project instructions. Update at end of campaign with retro learnings.
