# Engine Roadmap v2 — funnel-first

**Date:** 2026-08-21 · **Supersedes** `MULTICHANNEL_ENGINE_ROADMAP_2026-08-21.md` (v1) and
adjudicates the audit (PR #835, `MULTICHANNEL_ENGINE_ROADMAP_AUDIT_2026-08-21.md`). Keep both
for background; this is the canonical fallback document.

**Amendment v2.1 (2026-08-25, Matas):** landing pages ALWAYS precede campaigns. An LP is a
standalone client-facing product with its own creation, approval and testing cycle — it is
never minted inside a launch flow. B.1 is re-scoped to **URL consumption**: the wizards offer
an existing live, configured event page when one exists, and otherwise accept any pasted URL
(client's own page, cirqlin page, RA/Dice, anything). Wizard-side quick-create is DELETED
(follow-up to PR #843), including its POST route unless a non-wizard caller exists. The
funnel middle populates opportunistically whenever the chosen URL is ours and shows honest
not-instrumented states otherwise — so **Checkpoint B is dissolved as a gate**. Consequence:
**Phase D (plan spine — one input set → Meta + TikTok + Google with a shared goal and
budget) is promoted to NEXT**, and Phase C (self-learning benchmarks) runs in parallel as
data accrues rather than gating anything. The engine's purpose, in one sentence: launch
three campaigns at once from the same inputs, report them into one dashboard, and let each
channel's results inform recommendations across all three.

**The correction this version encodes (Matas, 2026-08-21):** in music-event marketing,
accurate purchase-conversion tracking is structurally out of reach and will stay that way.
~90% of ticketing is split across outlets — RA, Dice, Skiddle — with no open APIs, and
clients have legitimate data-protection reasons not to hand over ticketing dashboards.
4thefans-style API ingestion is the exception, never the template. What we CAN measure:
reach, clicks, landing-page views, signups (excellently, on our own LP software), and
pixel-attributed conversions where tracking exists. Purchases enter manually.

So the engine is not an attribution engine. It is a **learning funnel engine**.

---

## 1. The reframe

v1 (and Northbeam's model) put a spend×conversion JOIN at the centre and built decisions on
it. That design chases the one number this industry cannot give us deterministically. v2 puts
the **funnel** at the centre:

```
   reach ──► clicks ──► landing-page views ──► signups ──► purchases
   per-platform,        first-party            first-party   manual entry
   deterministic        (our LP software)      (our LPs)     + pixel-attributed
   (platform APIs)                                           where present
```

- **Top of funnel is deterministic per channel.** Reach and clicks per platform per day are
  platform-reported and already in `event_daily_rollups`. Channel comparison happens HERE —
  cost per click, cost per LPV, cost per signup per platform — where the data is plentiful
  even at £25–50/day.
- **Middle is ours.** LPVs and signups come from landing pages we own. No one else's pixel,
  no one else's consent chain.
- **Bottom is calibration, not attribution.** Purchases (manual, snapshot, or
  pixel-attributed) validate and tune the funnel rates. Per-channel purchase estimates are
  MODELLED through the funnel and always labelled as modelled.

**Seed benchmarks** (4thefans experiments): reach→click 15%, click→LPV 50%, LPV→purchase 5%.
These are level-0 defaults only. The system's job is to replace them, per client, with
observed rates — and to show the client that happening.

**The retention thesis:** clients stay because their dashboard knows THEIR funnel. Every
campaign sharpens their benchmarks; insights compound; leaving means starting from industry
averages somewhere else. The learned benchmark IS the switching cost. Self-learning is not a
phase — it is the design principle every phase serves.

## 2. What this kills, keeps, and changes from v1 + audit

**Killed:** deterministic per-channel purchase attribution as a goal (even "where API
exists" as a design centre); marginal-CPS budget recommendations as the primary decision
basis (audit was right — underpowered; funnel-stage diagnostics replace them);
ref=mt|tt|gg stamping (click IDs fbclid/ttclid/gclid are already captured in
`event_signups.utm` jsonb and platforms stamp them automatically).

**Kept unchanged:** P0 tickets-leg fix (#146) — MORE critical now, since manual purchase
entry flows snapshots→rollups and the pipe is dead; plan spine as the multichannel adoption
lever; adoption checkpoint that can kill the decisioning thesis; paused-everywhere fan-out +
Meta idempotency prerequisite; MCP staged read/propose-first; rules of the road (v1 §5);
provenance labels on every number.

**Changed:** the reporting tier becomes FUNNEL reporting; forecasting decomposes through
funnel stages instead of fitting spend→purchase curves; recommendations become stage
diagnostics; landing-page adoption becomes a first-class workstream (the funnel middle only
exists if ads point at our LPs — today: ONE live page). *(v2.1: adoption of LPs remains
desirable but is no longer a gate — see the amendment above.)*

## 3. Existing assets, remapped to the funnel

| Funnel need | Asset | State |
|---|---|---|
| Reach/clicks per platform/day | `event_daily_rollups` (meta_impressions, meta_reach, clicks, tiktok_*, google_*) | SHIPPED, fresh |
| LPVs + signups | LP software, `event_signups` with `utm` jsonb incl. click IDs | BUILT, ~unadopted (1 page, 1 signup) |
| Manual purchases | `ticket_sales_snapshots` manual provider + bulk manual endpoint | SHIPPED — rollup tickets leg restored by #836 |
| Pixel-attributed purchases | Meta pixel + CAPI per client, `meta_regs` | SHIPPED where configured |
| Benchmark store | `event_funnel_overrides` (migration 060) + Funnel Planner UI shell | SEED EXISTS — v1 barely used it; v2 makes it central |
| Client-visible surface | `/admin/[clientSlug]` client dashboard | SHIPPED |
| Launch | Meta/TikTok/Google wizards | SHIPPED (Google thin) |

The funnel engine is substantially more built than the attribution engine ever was.

## 4. The path

*(v2.1 ordering: P0 ✓ → A ✓ → B-as-amended ✓ → **D** → E.3-lite → C in parallel → E → F.
Original phase text below is retained; read B and C through the amendment.)*

### P0 — Restore the bottom of the funnel (SHIPPED — #836)
**#146:** fix the snapshots→rollups tickets leg, backfill July–August, regression-pin,
freshness alarm to ads_urgent. Without this, even manual purchase entry is invisible.

### Phase A — Funnel reporting tier (SHIPPED — #837, #838, #839; A.4 folded into A.1)
- **A.1** Per-event funnel view: reach → clicks → LPV → signups → purchases, per-stage
  conversion vs benchmark, per-platform split on the top stages. Data provenance badge per
  stage (platform-reported / first-party / manual / modelled).
- **A.2** Cost-per-stage per channel: CPC, cost/LPV, cost/signup by platform — the honest
  channel comparison that replaces purchase attribution.
- **A.3** Manual purchase entry UX: weekly totals per event, trivially easy — and exposed in
  the CLIENT dashboard so clients enter their own sales. Solves data protection (they give
  numbers, not dashboard access), creates engagement (they watch their funnel update), and
  feeds the learning loop. Flows through existing manual snapshot provider.
- **A.4** Benchmark display: show the 15/50/5 defaults as explicit "industry seed" values
  next to observed rates, so the learning journey is visible from day one.

**Checkpoint A:** one client can see their full funnel with per-stage rates vs seed
benchmarks, enters sales themselves, and the numbers reconcile with what they know. Billable.

### Phase B — Landing-page instrumentation (RE-SCOPED by v2.1; #840, #841, #842, #843 + URL-consumer follow-up)
- **B.1** *(as amended)* Wizards CONSUME destination URLs: offer an existing live event page
  when one exists; accept any pasted URL otherwise. No creation from any launch surface —
  LPs are made in the LP product, upstream, with their own approvals.
- **B.2** LPV capture verified end-to-end (`lp_page_views`, migration 155) and joined to
  the funnel view; click-ID capture confirmed on real traffic.
- **B.3** Off-funnel audit for live campaigns: surface which running campaigns point at
  on-platform links; honest relaunch CTAs, no in-place writes.

**Checkpoint B: DISSOLVED (v2.1).** Instrumented-LP launches are opportunistic, not gated.

### Phase C — Self-learning benchmarks (3–5 PRs; runs in PARALLEL once real funnel data accrues)
- **C.1** Benchmark model: extend `event_funnel_overrides` toward
  `client_funnel_benchmarks`: per client × stage (later × phase × platform) observed rate,
  n, confidence, provenance (seed | learned | manually-overridden), updated_at.
- **C.2** Learning job: rolling update from completed/ongoing events; shrinkage toward seed
  when n is low (pooling: event → client → industry seed); never let one small event swing a
  client's benchmark.
- **C.3** Surfacing: "your click→LPV is 41% (learned from 6 events), industry seed 50%" —
  the sentence clients stay for. Benchmark history sparkline.
- **C.4** Phase-awareness: rates keyed to announce/presale/on-sale where n allows —
  deterministic boundaries are our structural edge.

**Checkpoint C:** a client with ≥3 completed events has learned benchmarks that differ from
the seed and are used everywhere the seed used to be.

### Phase D — Plan spine (NEXT per v2.1; ~6–9 PRs)
`campaign_plans` + splits + adapters + fan-out through existing wizards. Prerequisite PR:
paused-everywhere launch + Meta idempotency ledger (audit disagreement 6 — conceded).
Destination URL is whatever the plan specifies (v2.1) — an event LP when one exists, any
client URL otherwise. One input set → three platform launches, shared goal and budget,
partial success first-class, everything created paused behind its own killswitch.

**Adoption checkpoint (kill-switch):** within M weeks of Phase D shipping, ≥N events run
2+ platforms through plans (suggest N=5, M=6 — set honestly at the time). If not met, stop:
the multichannel decisioning thesis is wrong for this client base, and Phases E–F do not
proceed on momentum.

### Phase E — Funnel-based forecasting + stage diagnostics (4–6 PRs; E.3-lite may ship early on top-of-funnel data alone)
- **E.1** Forecast by decomposition: planned spend × learned CPM/CPC per platform → reach,
  clicks → learned funnel rates → projected LPVs, signups, (modelled) purchases, with bands
  from benchmark confidence. Rendered on the plan screen pre-launch. Far more tractable than
  spend→purchase curves: every stage has its own, larger n.
- **E.2** Forecast-vs-actual per stage, public error tracking — the model earns trust or
  doesn't, in front of the client.
- **E.3** Stage diagnostics as the recommendation engine: "click→LPV 20% vs your 45% — link
  or page problem"; "TikTok CPC half of Meta's but LPV rate lower — net cost/LPV still
  favours Meta"; "LPV→signup collapsed on mobile this week." Playbook-based, robust at low
  spend, and each one is an INSIGHT the client learns from — the retention engine working.
  Budget-shift suggestions only where a stage-cost gap is large and sustained; never from
  purchase-level statistics at this spend.

**Checkpoint E:** one plan launched with a pre-spend forecast; per-stage actuals land inside
bands; at least one diagnostic led to a change a media buyer agrees was right.

### Phase F — Apply, API, MCP (staged; unchanged adjudication)
Dashboard apply for budget changes behind the #120 3-gate pattern; thin authed HTTP API; MCP
read + propose first, apply via MCP only after Checkpoint E quality is proven.

## 5. Not building
- Ticketing-outlet scraping, browser plugins, or dashboard-access requests — structurally
  closed doors; manual + pixel + funnel modelling replaces them by design, not as a stopgap.
- Landing-page creation inside any launch flow (v2.1) — LPs are upstream, standalone,
  approval-gated.
- User-level journeys, incrementality, Bayesian MMM.
- Statistical budget reallocation at current spend levels.
- Auto-apply anything before its checkpoint.

## 6. Fallback test (v2.1)
1. Is the bottom of the funnel visible again (P0/#146)? ✓
2. Can a client see their funnel with honest provenance and enter their own sales? (A) ✓
3. Do the wizards consume the event's real URL cleanly, offering ours when one exists? (B
   as amended) ✓ pending URL-consumer follow-up
4. Does one plan launch multiple platforms from one input set, and did adoption clear the
   kill-switch? (D)
5. Are benchmarks visibly becoming THEIRS rather than the industry's? (C, parallel)
6. Do forecasts and diagnostics change decisions, with tracked error? (E)
First "no" is where to return to. Work that moves none of these is off-roadmap.
