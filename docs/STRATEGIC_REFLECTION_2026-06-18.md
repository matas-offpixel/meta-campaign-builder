# Strategic reflection — the next step-change up

**Date:** 2026-06-18
**Author:** Commercial+Ops (Matas-instigated)
**Frame:** Asset queue was a step-change. What's the equivalent move for creative + d2c + a day/week ops panel?

---

## What this is

The user asked for a deep audit and a step-change-up plan. The dashboard was the first leap. The asset queue (PRs #555-#594, ~2 weeks of dense iteration) was the second — operator-time on 4thefans collapsed because Joe maintains a Google Sheet and the system turns that into Meta-launched ads with one click. This document is about leap #3: what would another whole-step-up look like, grounded in what's actually been built — not what's been talked about.

The honest discipline: don't propose anything that ignores the current state. Don't ignore what's working. Don't reinvent. And don't dodge the fact that one of the previous reflection's items (dashboard performance) **never shipped** — the team executed productisation instead, and that's the gap to acknowledge.

---

## What's actually live (ground truth from this audit)

### Asset queue — the productivity proof

It works because of five reinforcing properties, not one:

1. **Trigger source isn't us.** Joe edits a Google Sheet. The system scrapes. That collapses the "ask Matas to set up" loop entirely.
2. **SHA256 dedup** on sheet rows means re-scraping is free — no fear of running the pipeline multiple times.
3. **Dropbox-folder-as-batch.** One folder URL → all child files extracted, downloaded, dedup'd, bound to ad slots. The unit of work is the folder, not the file.
4. **AI-resolved copy + venue matching** runs once per batch (Anthropic call cost is negligible vs operator-time saved).
5. **Confirm → Launch wired straight into the bulk-attach wizard.** Four-screen wizard collapses to a queue-driven flow; assets pre-bound, copy pre-filled. PR #583 is the multiplier.

The result: **operator-time on 4thefans event launches dropped to near-zero.** Matas only touches it for venue overrides and review.

### Creative — Remotion is a POC, autotag is isolated, tagging-to-targeting loop doesn't exist

- One Remotion composition (`4tfCityStatic`) renders 1080×1080 stills. PhotoReelStatic is WIP. `FEATURE_REMOTION` is still off in prod (per the four-thread tracker).
- Autotag (Sonnet 4.6 vision) runs on a cron, writes to `creative_tag_assignments`. **No UI to filter creatives by tag, no feedback loop from performance back to tagger, no connection to the asset queue.** Tagging is post-hoc analytics with no actuation.
- The asset queue → Remotion path **doesn't exist**. Queue produces "the assets the client gave us, attached as Meta ads." Remotion produces "synthetic asset variants for one composition." There's no bridge that says "queue saw this clip, render 5 variants of it via Remotion."

### D2C — Mailchimp lives, Bird/Klaviyo/Firetext are stubs

- Architecture is clean: `d2c_connections` + `d2c_templates` + `d2c_scheduled_sends`. Encryption in place (migration 042). Approval gating wired. Cron pattern proven.
- **Email through Mailchimp is the only live channel.** SMS/WhatsApp infrastructure exists as stubs — every `validateCredentials()` and `send()` throws `NotYetImplementedError`. Gated on Joe's webhook + WhatsApp Cloud API approval.
- The brief-intake automation surfaces D2C drafts as markdown blocks for Matas to paste into Mailchimp by hand. **No automated draft → schedule → approve → send pipeline yet.**

### Reporting + dashboard — operationally mature, cross-client benchmarks missing

- Unified trend chart works (single aggregator across event types).
- Active-creatives snapshot cache is mature, stale-while-revalidate works.
- Attribution layer (PR #424 era) is dark-shipped, awaiting Joe's webhook.
- Benchmark verdict comparator exists (`compareToBenchmark`) and ad-account-level benchmarks exist (≥5 campaigns rolling window).
- Pacing alerts (per-client venue rollup) render on the Today page.
- **Cross-client cohort benchmarks don't exist.** Today's benchmarks are scoped to a single ad account. There is no "median CPA for a 1k-cap dinner show in London in May across all our accounts" — that data structure isn't there.
- **No reallocation suggestion engine.** Alerts surface symptoms; there's no logic that says "shift £200 from adset X to adset Y because Y is +15% above cohort."

### The 2026-05-08 gap (worth naming)

That reflection said: reporting is solved → speed is next → productisation third. The team has shipped Remotion + asset queue + bulk-attach (Ring 3, productisation) at high velocity. **The Ring 1 dashboard performance work never landed.** No `perf/client-portal-loader-parallelise` branch, no `client_dashboard_snapshots` migration. Internal `/clients/[id]/dashboard` still does 10+ sequential service-role round-trips, 1.5–3.5s pre-render latency per the 2026-05-08 note.

This is a *defensible* path-change — Joe's daily operator demand pulled productisation forward. But it should be acknowledged. There is no new strategic-reflection doc since 2026-05-08; this is it.

---

## The leap

The asset queue's pattern is the template. Apply it to creative + d2c + ops oversight.

### The pattern, abstracted

| Layer | Asset queue | Creative leap | D2C leap | Day/week ops leap |
|---|---|---|---|---|
| Trigger | Joe's Google Sheet | Client IG/TikTok feed + autotag taxonomy | Event milestone (presale, payday, T-N days) | Cross-client cohort drift |
| Dedup | SHA256 row hash | Clip content-hash + render-spec hash | Template + segment + event hash | Alert entity + day hash |
| AI assist | Copy + venue match (1 call/batch) | Frame select + cut + caption (N calls/clip) | Comms draft (1 call/event milestone) | Drift classification + reallocation suggestion (1 call/cluster) |
| Multiplier handoff | Bulk-attach wizard | Bulk-attach wizard (same path) | Mailchimp + Bird approval queue | One-click action: pause / reallocate / draft chase |
| Approval gate | Confirm before launch | Confirm before render-batch + before Meta upload | Approval queue, same pattern as today | Operator confirms each suggested action |

Same shape, four surfaces. Each surface gets a Joe-equivalent trigger source so **Matas isn't the initiator anymore**.

---

## Surface 1 — Creative auto-variation from viral social clips

### The shape

Each client has a watched-IG-and-TikTok handles list (their own + relevant artist accounts). A cron polls Meta/TikTok public APIs for new posts in the last 24h, ranks by virality signal (rate-of-engagement growth in first 6h), passes top-N candidates through:

1. **Frame extraction** (FFmpeg or `@remotion/media-utils`): pull 30 keyframes per clip.
2. **Frame selection** (Sonnet vision): score frames against `creative_tags` taxonomy + "is this a recognisable moment" classifier. Pick top 3.
3. **Composition assembly**: Remotion takes (clip + selected frames + brand colour + headline copy variants) and produces 5 UGC-style edits — different cuts, different overlay text positions, different captions.
4. **Autotag** the rendered variants (already wired).
5. **Surface in the asset queue** with status `pending` — Matas reviews + confirms exactly like the Dropbox flow today.

### What needs building (concrete, not hand-wavy)

- **New table:** `client_social_watch_handles` — per-client IG/TikTok handles to monitor.
- **New cron:** `/api/cron/scan-social-virality` — runs every 4h, calls IG Graph API + TikTok Display API for tracked handles, scores virality, writes candidates to a new `social_clip_candidates` table.
- **FFmpeg integration:** new lib `lib/creatives/video-frame-extractor.ts`. Vercel function path is fine for ≤30s clips (the Remotion-on-Vercel decision applies here too — no AWS needed at our volume).
- **New Remotion composition:** `UgcEditFromClip` accepting `{clipUrl, selectedFrameTimestamps, hookText, brandColour, overlayPosition, musicBedUrl?}`. Vertical 9:16.
- **Bridge into asset queue:** rendered variants land in `client_asset_queue` with `source='remotion-ugc-auto'` instead of `source='dropbox'`. **Reuses the existing confirm + launch UI verbatim.** No new operator surface.

### Why this is the right leap

The competitor walkthrough showed Remotion at 121 events solo. We've shipped Week 1. What he has that we don't is **trigger-source automation** — his "city/hook/script variations" come from a pre-built input matrix, not a wizard prompt. Our Remotion sits behind an admin form. Wiring it to **a virality-watched social trigger** is the equivalent move to Joe's Google Sheet for assets: the *client's own social activity* becomes the trigger source.

Effort estimate: **2-3 weeks** for a Cursor execution sprint. Week 1 already-shipped infrastructure carries 60% of it.

---

## Surface 2 — D2C with minimal-touch milestone prompts

### The shape

Every event in the system has known milestones derived from `event_date`, `presale_at`, `general_sale_at`, `announcement_at`:

- Announcement (T-N days, configurable)
- Presale primer (T-3 days before presale)
- Presale live (presale_at)
- General sale live (general_sale_at)
- Payday-Friday push (last Friday of month × 16-day window logic from project context)
- T-10 day urgency
- T-3 day urgency

A daily cron (`/api/cron/d2c-milestone-scheduler`) inspects all upcoming events, checks the `d2c_scheduled_sends` table, and **auto-creates draft rows for any milestone that's due within 14 days and doesn't yet have a draft**. Each draft uses the client's house template (already in `d2c_templates`) plus AI-drafted content via Anthropic (already in the asset-queue copy generator pattern). Status: `pending_approval` + `dry_run=true` — same gate as today, no change to safety model.

Matas (or Sarah) opens the approval queue once a day, reviews drafts, clicks approve. The existing cron sends.

### What needs building

- **New cron:** `/api/cron/d2c-milestone-scheduler` — runs daily. Per upcoming event: compute milestone calendar from event metadata, emit drafts for unsent + un-drafted milestones within window.
- **Template milestone metadata:** extend `d2c_templates` with `milestone_type` enum (`announcement`, `presale_primer`, `presale_live`, `general_sale`, `payday_push`, `t_minus_10`, `t_minus_3`). Per-client default mapping in a new `client_d2c_milestone_config` table.
- **Approval queue UI:** new `/d2c/queue` route. Lists pending drafts grouped by client + event + send date. One-click approve/reject/edit-then-approve. Mirrors the asset-queue confirm pattern.
- **Bird/Klaviyo stubs activate** when Joe's webhook lands (separate dependency). The scheduler is channel-agnostic — it writes the draft, the provider decides if it can actually send.

### Why this is the right leap

D2C drafting is Matas's manual work today. The brief-intake automation produces markdown blocks; he copies them into Mailchimp; he schedules manually. **The milestone scheduler turns event-date metadata into the trigger source** — Matas doesn't write or schedule, he reviews. Same shape as Joe-edits-the-sheet.

Effort estimate: **1.5-2 weeks.** Heavy lift is the milestone-detection logic + UI; provider work is mostly already-stubbed.

---

## Surface 3 — Day/week ops panel with cross-client cohort benchmarks

This is the one that hits Matas's "things flag themselves" framing most directly.

### The shape

A daily-refreshed page at `/ops/today` (or extends the existing Today page) that surfaces, per client, **only the things needing attention** — not a comprehensive dashboard. The instinct should be: scrolling needed = the system isn't filtering hard enough.

Three drift detectors:

1. **Spend pacing drift:** budget burn rate vs forecast curve. Already partially there (per-client pacing alerts). Extend to flag "overspending vs benchmark for this event-size/region/days-to-go cohort."
2. **CPA/CTR/CPM cohort drift:** rank each active campaign against cross-client benchmarks (same event-type + region + month). Surface campaigns in worst-quartile. Per-account benchmarks already exist; the cross-client cohort layer doesn't.
3. **Creative fatigue / scaling opportunity:** already in `benchmark_alerts`. Surface unacknowledged.

Each surfaced item has a **suggested action** with a one-click execute:
- "Pause adset X" → POSTs to Meta API (existing path)
- "Reallocate £200 from X to Y" → two POSTs, atomic
- "Draft chase comms" → creates a D2C draft via Surface 2's scheduler

### What needs building

- **New migration:** extends `benchmark_alerts` with cohort bucket fields (event_type, region, capacity_bucket, days_to_go_bucket).
- **New cron:** `/api/cron/compute-cohort-benchmarks` — runs daily. Groups active campaigns by cohort, computes p25/p50/p75 for CTR/CPM/CPC/CPA. Writes to a new `cohort_benchmark_snapshots` table (one row per cohort per day).
- **Reallocation suggestion engine:** `lib/dashboard/reallocation-suggestions.ts` — given a client, compares each adset to its sibling adsets and to the cohort. Returns suggested (from, to, delta, expected impact) tuples.
- **Action layer:** `lib/meta/atomic-budget-shift.ts` — pause + activate + budget update in a single API batch with rollback on partial failure. New surface, but reuses existing Meta client.
- **Ops panel UI:** the new page itself.

### Why this is the right leap

Right now Matas reads the dashboard to know what's happening. **The leap is: the panel reads itself and tells Matas only what's drifting.** Same operator-time compression Joe got. The benchmark verdict comparator already exists. The cohort layer is the missing piece.

Effort estimate: **2-3 weeks.** Heaviest piece is the cohort benchmark computation cron + the reallocation logic.

---

## What I would NOT propose

A few things that look tempting but aren't the right next move:

- **Replacing the bulk-attach wizard or asset queue UI.** They work. Don't touch.
- **Building a no-code Remotion composition editor.** The TSX-in-Cursor authoring path is faster than maintaining a UI.
- **A full LLM agent that "operates" the agency.** Approval gates are non-negotiable; agentic full-auto is not the path.
- **Yet another dashboard surface.** The user explicitly asked for a *day/week panel that says what needs attention* — that's the opposite of a new dashboard. It's a filter on existing data.
- **Solving the 2026-05-08 dashboard latency now.** It's annoying but Joe didn't ask for it. Productisation is the higher-ROI path. **Add it to memory as deferred, don't quietly skip it again.**

---

## The unified path (priority order)

If executing one at a time with a single Cursor thread:

1. **Surface 2 (D2C milestone scheduler).** Smallest scope, fastest payoff, immediate Matas-time saving on the work he does daily today.
2. **Surface 3 (day/week ops panel + cohort benchmarks).** Builds on existing benchmark + pacing infrastructure. Highest commercial leverage for the MoS/Ironworks/next-tier pitch.
3. **Surface 1 (creative auto-variation from social).** Largest build. Best done after Remotion Week 2 + Week 3 (template catalogue) lands — currently in the creative thread's handover.

If executing in parallel across the four threads:
- **Creator+Reporting** owns Surface 3 (cohort benchmarks + ops panel) and the deferred dashboard latency.
- **Creative** continues Remotion Week 2/3 → Surface 1.
- **D2C** owns Surface 2.
- **Ops** continues commercial work (Ironworks pricing tier, Standard API tier, finance hygiene) and owns this strategic-reflection document.

---

## The honest test for this plan

The asset queue's success was visible in one metric: **operator time per 4thefans event launch**, which dropped from ~hours to ~minutes. The equivalent metrics for the three leaps:

- **Surface 1:** time from "client posts a viral clip" to "5 platform-native ad variants in the asset queue ready for review." Target: under 1 hour, automated.
- **Surface 2:** time per client per month spent on D2C drafting + scheduling. Target: 30 min total per client per month (review only).
- **Surface 3:** number of campaign-level decisions Matas has to *initiate* per week. Target: zero — every adjustment originates as a flagged suggestion he confirms.

If those three metrics move, this is leap #3. If they don't, the plan was wrong.

---

## Acknowledged-but-deferred items

- Internal `/clients/[id]/dashboard` perf (10+ sequential round-trips → 1.5-3.5s pre-render latency). 2026-05-08 reflection's Ring 1. Still unaddressed. Worth a `cc/` single-PR pass at Promise.all in the next session.
- Sarah-led data-infra positioning doc never landed. Still relevant; Matas's preferences flag this as multi-year.
- Brand Campaign pricing tier on /quote (task #14). Independent of this plan, still pending.

---

## D2C orchestration sprint — shipped 2026-06-30

- Brief PDF → 6-milestone campaign automation live (PR #647). The parser
  (`lib/d2c/brief-parser/`) turns a brief into an event + per-milestone rendered
  copy + a full set of scheduled sends (`announce`, `reminder`,
  `community_early`, `presale_live`, `gen_sale`, `autoresp_setup`), keyed by an
  idempotency key so re-ingesting a brief upserts rather than duplicates.
- Bird provider got its real implementation (`lib/d2c/bird/`); Mailchimp was
  already shipped. Both share the provider interface and the dry-run gate.
- Asset resolver chain: `d2c_event_copy.artwork_url` → asset queue → Bird Media
  Library, falling through on miss (`lib/d2c/assets/`). The Drive provider
  chains in here once the Creative thread lands.
- 3-of-3 dry-run invariant (`FEATURE_D2C_LIVE` + per-client `live_enabled` +
  per-client `approved_by_matas`) plus the per-send Matas approval gate are
  enforced provider-side and again cron-side in `/api/cron/d2c-send`.
- 5 WhatsApp templates are pending Meta approval; the whole orchestration runs
  dry-run until the first template is approved **and** a client is live-enabled.
- Only runtime human input: paste the WhatsApp community URL on
  `/d2c/event/[id]`; everything else is automated from the brief.

Open follow-ups:

- Full e2e against a real Jackies brief (parser accuracy + schedule correctness
  on live data) once a template is approved.
- Prod compute upgrade off burstable — P0 #639 recurred today (2026-06-30); the
  background `after()` brief processing makes this more urgent.
- Drive provider integration into the asset resolver chain (Creative thread).
- On-disk migration numbering reconciled with the prod ledger this PR
  (cron-health 124, d2c orchestration 126, brief-ingest 127).

---

End reflection.
