# Strategic reflection — 2026-05-01

**Eight days since the last reflection (2026-04-23). The picture has changed materially.** This document supersedes nothing — it sits alongside the prior reflection — but the centre of gravity has shifted from "productisation arc" to "two parallel verticals (events + awareness) running on the same dashboard infrastructure".

---

## 1. The headline shift — awareness is reachable now, not Q4

The 2026-04-23 reflection treated the awareness / brand vertical as a long-term diversification play. Eight days of building has collapsed that timeline: BB26-KAYODE (Black Butter Records, Kayode artist release) is live as the first non-ticketed-event marketing engagement Off/Pixel has run end-to-end. The technical infrastructure that made it possible — cross-platform CPV reporting across Meta + Google Ads + TikTok with a unified share-report template — was almost a side-effect of the BR-readiness sprint. We built it for Boiler Room. We discovered we could sell it standalone.

The deliverable shape for awareness is fundamentally different from ticketed:

- No tickets to sell, no ROAS, no CPT — KPIs are CPV, video views, reach, engagements, demographics.
- Different sell motion. Labels and brands buy "extend reach for artist X" not "fill venue Y".
- Likely repeat-business rhythm. Black Butter has multiple artist releases per year; we are not pitching a one-and-done event.
- Lower urgency, lower volatility, lower per-engagement supervision.

This is a second vertical on the same rails, not a pivot. Both verticals will continue. But the strategic arc has bifurcated: ticketed events remain the cash engine; awareness becomes the leverage tier where margin compounds because creative refreshes and platform iteration cost less per pound of revenue than ticketing presales do.

## 2. The Boiler Room pitch is in flight

Proposal sent 2026-04-24. £5,000/month all-inclusive retainer plus £0.10/ticket sell-out bonus on any ticketed BR event Off/Pixel campaigns support. Five-week ramp to a 26 May kickoff. The pitch was honest about the £500/month premium over the incumbent's £4,500 fee — pitched against ads-only at £3,500 below it and conventional layered agency at £4,500 alongside it. Senior-only delivery, custom reporting platform, performance bonus aligned to outcomes.

Awaiting Ben's response. Whatever happens, the work the pitch forced us to ship — multi-platform integrations, awareness reporting template, partner-share-URL pattern at the schema layer — has already paid back the sprint cost. BR is a one-of-many catalyst, not the only outcome.

If BR signs: revenue jumps from £13k → £18k MRR in one client step. Three months to £20k target now needs about £2k of additional clients, not £7k.

If BR doesn't sign: the infrastructure built remains intact and the next pitch ships into a much more credible deliverable.

## 3. Multi-platform reporting infrastructure is now real

- **Meta** — mature, Meta-independent share rendering via PR #87 snapshot cache. 6-hourly cron, p95 share render <1 second.
- **TikTok** — shipped + verified in prod 2026-04-28. Migration 054 (encrypted credentials), 056 (rollup columns), 057 (snapshots), 058 (campaign drafts), 059 (breakdowns + metrics), 062 (write idempotency). Black Butter Records advertiser connected as first live integration via Rian Brazil Promo. Full pipeline: OAuth + rollup + share + breakdowns + wizard + library + brief export + write-API foundation behind feature flag.
- **Google Ads (incl. YouTube via Video subtype)** — shipped 2026-04-30 in a 17-PR evening sprint. MCC 333-703-8088, Basic Access 15k ops/day. Awareness reporting template unifies all three platforms into a single render path.

Three platform integrations in seven calendar days. This is the BR-readiness moat in technical terms — and it is a moat. Most competing agencies cobble Looker Studio screens together per-client; Off/Pixel ships a unified data model that absorbs new platforms without redesigning the share template each time. A potential fourth platform (LinkedIn? Reddit? Snap?) can be added in a few days because the ingestion pattern is now well-trodden.

## 4. Motion replacement — Phase 2 is the in-house tagging

Motion trial cancellation booked for 2026-05-08 (calendar event set). The replacement is migration 061's `creative_tags_schema.sql` — the foundation for a fully-owned creative tagging taxonomy. Phase 2 (AI tagging via OpenAI) becomes viable once the tag schema seeds with real Off/Pixel campaigns over the next 4–6 weeks.

Strategic call: build, not subscribe. Reasons that held up after building it:

- Motion's monthly fee compounds; in-house tagging cost is amortised against existing infrastructure.
- Tag schema needs to map to Off/Pixel's reporting model, not Motion's. Bespoke wins.
- Data stays in our database. No vendor lock-in, no question about data residency or aggregation rights for clients.
- Sarah's data-platform background makes tagging governance a natural fit.

## 5. 4thefans dashboard reconciliation closed

Nine PRs aligned the 4thefans dashboard end-to-end with Meta source-of-truth (project_dashboard_session_2026-04-28_arc). Migration 055 applied. The portfolio rollup view (multi-event client-scope dashboard) is queued for June — explicitly *not* in the BR five-week ramp because parallelising with BR Week 5 was the fastest way to compromise both.

This matters strategically: 4thefans, BB26-KAYODE, BR are now structurally similar from the dashboard's perspective. Three different ICPs (sport-fan-zone, music-label, music-broadcaster) all sharing one rendering infrastructure. The marginal cost of adding the fourth client of any type is low.

## 6. Awareness vs ticketed pricing — open decision

Current pricing model (`pricing — minimum £750, fee cap £4,000–5,000, sell-out bonus £0.10/ticket`) is ticket-centric and breaks for awareness work in obvious ways: there is no sell-out, the per-ticket bonus is meaningless, the fee cap was set against ticketing budgets. Decision blocking Monday's planning slot.

Suggested directions (to be locked Monday):

- Flat fee per campaign window — tiered against budget (e.g. £750–£2,500 for small/medium/large awareness windows).
- Drop the sell-out bonus for awareness work entirely; consider a CPV-vs-target performance bonus instead.
- Add "creative refresh" cadence as a deliverable line item, since awareness campaigns are not one-and-done.
- A retainer offering for labels with frequent releases — Black Butter is plausibly retainer-eligible (multiple artist drops per year).

The deeper strategic question this surfaces: do we have ONE pricing page or TWO? Probably two — published clearly so brand-side prospects don't have to translate event-pricing into their own context.

## 7. Sarah's expanding surface

Three pieces of evidence have accumulated that point to Sarah operating a standalone data-infrastructure service tier (not just supporting Off/Pixel campaigns):

1. The cross-platform reporting infrastructure that justifies BR's £5k retainer is, technically, Sarah-led data work.
2. BB26-KAYODE's awareness reporting template is the kind of cross-platform dashboard that adjacent agencies and labels would buy as a service.
3. Sarah's existing client roster (Google, Datatonic, Richemont, Deutsche Bank) is itself a credible non-Off/Pixel sales surface for governance + data-training engagements.

The Q3 vector worth developing: Sarah-led data-infrastructure subscription tier — possibly under an Off/Pixel sub-brand or as a sibling service. Not blocking; not actionable in May. Worth a 2-page positioning doc by mid-June.

## 8. Productisation arc — bifurcate by kind

The 2026-04-23 productisation arc (brief schema → template cloning → rented creative APIs → tier-based spawner) survives intact, but every layer needs to fork by `events.kind`:

- **Brief schema** — shared root fields, divergent tail per kind. Awareness briefs need partnership-brand context, CPV target, channel mix, content asset count. Ticketed briefs need presale window, capacity, ticket tiers.
- **Template cloning** — must carry `kind` through. A BR partnership template clones into a `brand_campaign` event. A Junction 2 series template clones into `event` rows.
- **Tier-based spawner** — needs awareness-tier presets alongside ticketed presets. The spawner doesn't know which is needed until the brief lands; both must be available.

This is not a re-architecture. It is annotation. The bones are right; the muscles need labelling.

## 9. Operational state — what's working, what's not

**Working:**
- Four-thread Cowork model holding well. Handovers between threads flow through `docs/HANDOVER_*.md` files and memory entries. Cross-thread contradiction is essentially zero.
- Auto-merge enabled repo-wide 2026-04-30. ~5 minutes saved per Cursor PR going forward.
- Standing permissions installed (Friday hygiene, cross-thread reads, sub-agent use, direct memory edits). Time saved per session is meaningful.
- Brief intake automation pipeline encoded — paste-and-process from ~30 min manual entry to ~3 min review.
- Cursor budget burn ~30 PRs/week against £1k authorised — needs a mid-month glance vs runway, but on track.

**Not working / friction:**
- Migration filename collisions at 060 and 061 broke the `tail -1` next-integer rule. Cursor PR queued to rename. Process drift to watch for.
- Awareness pricing model unresolved — second awareness client through the door without a price list is a real risk.
- Memory size growing (60+ entries). Friday hygiene pass needed; consolidate-memory skill should run.
- Documentation drift — CLAUDE.md migration head reference was stale (041 → now 062 / 064 post-rename). Friday refresh.

## 10. The supervision ceiling

The 2026-04-30 awareness sprint shipped 17 PRs in one evening. That is high throughput, but it took six hours of intense supervision: prompt drafting, merge decisions, regression checks against the awareness branch protection rules, eyeball-checking the Black Butter render. Not sustainable cadence.

The corollary worth sitting with: the ceiling on what Off/Pixel can build internally is not what Cursor can output. It is what Matas can review. Cursor's effective capacity has overtaken supervision capacity. This has implications for the founder-mode → built-organisation transition that Sarah's expansion is heading toward — but the more immediate implication is that selectivity (what NOT to ship) becomes higher-leverage than throughput.

Not actionable in the next sprint. Worth re-reading at the next reflection.

## 11. Next 30 days — May 2026

**Early May:**
- BR kickoff prep. Mint first BR partnership share URL (White Claw or Budweiser staging) by Week 5.
- Migration filename collision cleanup PR ships before next migration.
- Awareness pricing tiers locked Monday 2026-05-04.
- Motion trial cancelled 2026-05-08 (calendar set).
- Cursor budget mid-month checkpoint mid-May.

**Mid-May:**
- BR onboarding flow if signed. CPV benchmark backfill (90-day historical for BR ad accounts).
- 4thefans portfolio rollup foundations begin (groundwork only — full ship is June).
- Sarah-led data-infrastructure positioning doc drafted (2 pages, internal).

**Late May:**
- BR kickoff 26 May.
- First Friday content cadence post — BB26-KAYODE methodology / "How we report on brand awareness campaigns vs ticketed events".
- Awareness pricing page live on offpixel.co.uk.

---

## What stayed the same as 2026-04-23

The productisation arc shape (brief → template → spawner). The Junction 2 / Drumsheds / Broadwick Live evidence base. The £20k MRR target by mid-Q3. The hiring stance (no hires through 2026 H2). The Friday-business-dev / Tue–Thu-clients / Mon-planning rhythm.

## What's resolved since 2026-04-23

- BR pitch sent (was: drafting).
- £1k Cursor budget approved (was: implicit, no ceiling).
- Multi-platform reporting infrastructure live (was: critical-path Q2).
- TikTok integration shipped (was: app approval pending).
- Google Ads integration shipped (was: Basic Access pending).
- Auto-merge enabled (was: manual-merge dance per PR).
- Awareness vertical proven viable now (was: long-term diversification).

## What's open since 2026-04-23

- BR signing decision (Ben's reply).
- Awareness pricing model.
- Sarah-led data-infrastructure standalone service shape.
- 4thefans portfolio view (June ship).
- Migration collision rename PR.
- Memory hygiene pass.

---

*Prepared in ops thread, 2026-05-01. Next reflection: 2026-05-08 (post-BR-decision deadline if Ben replies in week, otherwise rolling).*
