# Off/Pixel — Strategic Reflection & Roadmap

**First written:** 21 April 2026
**Last reflected:** 22 April 2026 — one day later, but a meaningful one
**Business age:** ~2 months (founded 22 Feb 2026)
**Snapshot:** ~£13k MRR, 8 clients, 1 dashboard product, D2C schema scaffolded (dry-run), creative automation schema scaffolded (dry-run), creative reporting loop live today for the first time

This document is a living reflection on where the dashboard and tooling are. The 21 April pass treated most of the big automation workstreams as "missing entirely." In the 24 hours since, overnight Cursor runs and a production debug session have moved most of that ground forward — so the gap between "what we have" and "what we talk about having" is smaller than yesterday's version of this doc admitted. Rewriting to realign.

It assumes you've already read CLAUDE.md / AGENTS.md / PROJECT_CONTEXT.md and doesn't repeat that content.

---

## 1. Milestones — where we actually are (22 April revision)

### Shipped and solid

- **Full 8-step Meta wizard.** Account → campaign → optimisation → audiences → creatives → budget → assign → review/launch. No stub steps. Audience panel handles Page engagement, Custom, Saved, Interests, lookalike seeding, interest validation + deprecation fallback.
- **Meta API end-to-end.** `lib/meta/{client,campaign,adset,creative,upload}.ts` plus `app/api/meta/*`. Phased launch recovery, lookalike retry, interest sanitisation, cluster-based replacement. As of this week, the client layer also has hardened retry with backoff + Retry-After caps (`graphGetWithToken`, `RETRYABLE_META_CODES`).
- **Agency-OS data model.** Supabase schema has `clients`, `events` (`event_date`, `event_start_at`, `event_timezone`, `presale_at`, `general_sale_at`, `kind`), `venues`, `artists`, `event_artists`, `creative_tags`, `audience_seeds`, `campaign_drafts`, `campaign_templates`, plus client/event platform link tables. Migrations 003–032 show this grew deliberately.
- **Persistence + schema evolution.** Dual-layer (localStorage + Supabase), `migrateDraft()` handles forward-compat.
- **Auth.** Magic link + invite allowlist + RLS per user + three-client Supabase setup.
- **Event linkage in the wizard.** (PR #8, merged `fa6f554`.) Step 0 now picks client + event and auto-populates downstream — closes yesterday's "#1 event linkage" gap.
- **Event-aware wizard / phase detection / linked-campaigns rollup.** (PR #16, merged `1861179`.) `lib/wizard/phase.ts` computes `derivePhase` once and is reused everywhere else (reporting rollup, pipeline view).
- **Cross-event reporting rollup.** (PR #18 — Task A.) `/reporting` with client / date-range / platform filters, blended KPI strip, events table colour-coded against rolling-90 ad-account benchmarks. Reuses `lib/reporting/event-insights.ts`; `node:test` unit test for the aggregator.
- **Ticket pacing card.** (PR #19 — Task F, merged.) Inline-SVG chart (no new deps), `>5%` "plan vs latest snapshot" warning, empty-state deep-links.
- **Pipeline / kanban view on `/events`.** (PR #20 — Task G, merged.) Six-column `derivePhase` view, cancelled strip, filter contract preserved.
- **Creative Heatmap.** Tasks H1/H2/H3. Snapshot cache table (`creative_insight_snapshots`, migration 032), pre-warmed by `/api/cron/refresh-creative-insights` every 2h. Filter-bar reflow, sort, progress indication. First successful live render happened today on 4TheFans (GBP, Active, Last 7d) — 2,000 ads, £5,583 spend, 4.98% CTR, 4 fatigued creatives. **This is the reporting loop closing in real-time.**
- **Infrastructure maturity.** Vercel upgraded to Pro (22 April, £16/mo). Cron `maxDuration` bumped to 800s with soft-timeout at 790s. Inter-account spacing 10s. `/api/intelligence/creatives` capped at 300s for the user-facing live-fetch path. Cache write-through so the next default read is instant.
- **Shared report tokens.** Routes and structure in place for client-facing sharing (`/api/share/report/[token]/*`); UI thin but unblocked.

### Partially built — schema done, needs flags flipped and UX wired

- **D2C comms engine.** Migration 030 shipped. Tables: `d2c_connections`, `d2c_templates`, `d2c_scheduled_sends`. Provider adapters stubbed for Mailchimp / Klaviyo / Bird / Firetext behind `FEATURE_D2C_LIVE=false` (dry-run logger). This is the roadmap's old "#4 comms templating" item — schema-complete, not yet live.
- **Canva Connect / Bannerbear / Placid creative rendering.** Migration 031 shipped. Tables: `creative_templates`, `creative_renders`. Providers stubbed behind `FEATURE_CANVA_AUTOFILL` / `FEATURE_BANNERBEAR` / `FEATURE_PLACID`. This is the roadmap's old "#5 creative engine" item — ditto, schema-complete, not yet live.
- **Invoicing.** Table exists (migration 019), routes still return 501. Quote generator on the website still decoupled.
- **TikTok / Google Ads.** Schema + some routes (migrations 016/017), plus a TikTok manual reports import (`/api/tiktok/import`, migrations 026/028). No wizard surface yet; fan-out abstraction still not chosen.

### Missing entirely (the strategic gaps that remain)

- **Live D2C sending.** Schema and adapters exist but `FEATURE_D2C_LIVE` is off. We haven't tested real sends, haven't done per-client OAuth connection flows, haven't built the "generate all 10–12 comms for event X" wizard UI on top of the templating tables.
- **Live Canva rendering.** Same shape as above — tables done, no "pick template + autofill + render + attach to creatives" UX yet. Blocked partly on Canva Enterprise (Autofill API gate), so Bannerbear is the pragmatic first provider.
- **Claude-native copy-angle endpoint.** Still a chat loop. The `/api/creative/copy-angles` we talked about hasn't been built yet.
- **Automated optimisation execution.** The wizard can configure rules, but no background worker enforces CPA/ROAS thresholds. Still advisory.
- **Weekly Monday brief.** Not started.
- **Per-event AI brief on open.** Not started.

---

## 2. What's genuinely impressive here

Honest take, not cheerleading: the pace from "missing entirely" to "schema shipped, dry-run safe" on D2C and Canva inside 24 hours is the kind of compounding the Cursor-executes / Cowork-plans workflow was designed for. Two forces are stacking:

1. **The schema thinks ahead of the UI.** Yesterday's doc already called this out. Today it paid out again — overnight Cursor runs could land full D2C and creative-render tables inside a weekend because the event / client / artist model was ready to hang them off.
2. **Feature-flag-first shipping discipline.** Every risky new workstream lands behind `FEATURE_*` env flags with dry-run adapters. That means we can merge into `main` without going live, review in production, and flip the flag per-client when we're ready. The Vercel Pro upgrade + Cursor's habit of shipping dry-run stubs means we can keep moving without client-facing blast radius.
3. **Operational learnings from the 22-April rate-limit ordeal are now codified.** The cron debug session (PRs #26 through #32, full Meta pagination hardening, Pro-plan budget) produced a written playbook in the cron route's comments, a per-account logging pattern, and a rule in memory not to curl-force the same endpoint repeatedly because Meta's bucket stays warm and we punish ourselves.

Stop treating these like "basics." They're the scaffolding that lets the next 30 days be an execution month rather than a discovery one.

---

## 3. What to improve — brutal honesty, April-22 revised

### 3a. The reporting loop is officially closing — don't stop short

Yesterday: "you can't show a client a live campaign view from the dashboard." Today: the Creative Heatmap rendered 2,000 live Meta rows inside the widget for the first time. The `/reporting` cross-event rollup is live. The event-level ticket pacing card is live.

The loop is not fully closed — it needs:
- **A consistent surface area for external sharing.** `report_shares` table exists, but the heatmap isn't plumbed into it yet. The latent `as ResolvedShare` cast bug (see §3d) will bite the first time we mint a client-scoped share.
- **Persistence across accidental page refreshes.** Today's session surfaced a real UX bug: accidental reload nukes the loaded heatmap. Fix in `fix/heatmap-client-snapshot` is prompted and queued.
- **Table density / overflow.** Same branch handles the right-edge clip that hides `Reg. / CPR / Purchases` at the widget edge.

None of these are "build reporting from scratch" — they're "harden the reporting we've just shipped." Next 7 days material.

### 3b. Flip the flags — D2C and Canva are schema-rich, reality-poor

The uncomfortable truth: having tables behind feature flags is cheap theatre until one real client is using them. The discipline that unlocks the next £7k of MRR is picking one narrow slice and going live:

- **D2C slice to flip first:** Jackies presale-reminder email via Mailchimp. One client, one provider, one template. If that works, Phase 2 is the 24-hour WhatsApp reminder for the same client on Bird.
- **Canva slice to flip first:** 4TheFans fan-park statics via Bannerbear (not Canva — Bannerbear doesn't need Enterprise approval and supports autofill at $0.05–0.20/render). One client, one template, one variable set.

Both of these are 3–5 day pieces of work each now that schema is done. Both produce visible time savings inside the same week.

### 3c. Multi-platform is still half-laid

TikTok manual reports import is nice but isolated. Google Ads has tables and nothing else. The decision from yesterday still stands: either commit to Meta-only for 2026 H1 (rip TikTok/Google stubs), or commit to a `CampaignBrief` abstraction and do it properly. Half-built is still worse than either choice.

Revised recommendation: **stay Meta-only through end of June**. The Creative Heatmap only just started surfacing useful creative performance data. Don't fragment focus until that signal is driving decisions.

### 3d. Latent issues still on the board

- ~~**`report-shares` unsafe `as ResolvedShare` cast.**~~ **Resolved in PR #9** (2026-04-21). `resolveShareByToken` now returns a discriminated `{ ok: false, reason: "malformed" }` instead of crashing on null `event_id` / `client_id`. Client-scoped share minting is safe.
- **Facebook reconnect short-lived token.** `extendToken` failure on reconnect path — Matas's memory says "fix being done in Cursor, don't touch callback files." Check if it merged.
- **Meta app approval pending.** Clients still run ads in their own Ads Manager. This is a business-flow constraint, not a bug — but the dashboard needs to keep assuming `clients.meta_ad_account_id` can be null.

---

## 4. The creative time sink — attack plan (revised)

**What's changed since 21 April:** migration 031 shipped. `creative_templates` and `creative_renders` tables are live. Providers (Canva / Bannerbear / Placid / manual) are in the schema. Feature flags off.

**Scope note — no AI image generation.** AdCreative.ai / Pencil / Arcads / Midjourney are out of scope. Matas's deliverable is client-approved template adherence — fonts, placement, logo position, typographic hierarchy are all dictated by the client. The automation target is (a) Bannerbear autofill of existing Photoshop/Canva templates with structured variables, and (b) a CapCut overlay-text JSON export for video. Generative imagery would break the client contract and regress brand consistency. Every "creative engine" decision below is a template filler, not an image generator.

**Creative modes in practice (for context):**
- **UGC-style caption overlays on video** — currently done in CapCut by manually typing each caption. Automation target: overlay-text JSON export (see Phase 3).
- **Artwork overlays (artist-focus statics + video)** — currently edited from client Photoshop templates, then merged over clips in CapCut. Automation target: Bannerbear autofill (Phase 1).
- **Call-to-action overlays (statics + video)** — same workflow as artwork overlays. Same automation target.

**Phase 1 — Bannerbear-first live rendering (5 days)**
- Phase 1 of the old plan assumed Canva Connect as the autofill target. Revised: Bannerbear first because it doesn't need an Enterprise contract and prices per-render ($0.05–$0.20). Use `FEATURE_BANNERBEAR=true` and ship a narrow "render fan-park static for 4TheFans" UX as the live test.
- Keep Canva autofill stubbed for when the Enterprise side is ready.
- Shared variable schema (`{{event.name}}`, `{{artist.primary}}`, `{{sold_tier}}`) is the durable decision — whatever provider fires first, the variables are the same.

**Phase 2 — Claude copy-angle endpoint (3 days)**
- Still not built. Move the "3–4 angles" caption generation out of chat into `/api/creative/copy-angles`. Cache artist tone-of-voice in Supabase keyed by `artist_id`. Refresh monthly via a cron similar to `refresh-creative-insights`.
- Make this a button inside the wizard's Creatives step — not a chat.

**Phase 3 — CapCut overlay-text JSON export (2 days, higher-priority than previously scoped)**
- One-click export from the event record: structured JSON of every overlay string (artist name, date, venue, presale copy variants, ticket URL, caption-variant bank from the Claude copy-angle endpoint) formatted so Matas pastes it into CapCut's text layers instead of retyping each line.
- This kills the single biggest manual step in the current video-overlay workflow and is cheap relative to its time saving. Promoted from "nice to have" to roadmap item 8 in §7.
- No plan to replace CapCut itself — the tool is fine, the retyping is the waste.

**Phase 4 — Heatmap-driven template recommendations (new for this revision)**
- The Creative Heatmap now produces real per-creative CPR / CTR / spend. When Phase 1 live-rendering ships, use the heatmap to rank past templates for a given `(client, event_kind, phase)` and surface "use this template — it produced the best CPR for 4TheFans fan-park statics last cycle." This is the "system learns" loop finally closing.

---

## 5. The D2C time sink — attack plan (revised)

**What's changed since 21 April:** migration 030 shipped. `d2c_connections` + `d2c_templates` + `d2c_scheduled_sends` are live with provider stubs for Mailchimp / Klaviyo / Bird / Firetext. `FEATURE_D2C_LIVE=false` — everything is dry-run logger-only right now.

**Phase 1 — Mailchimp live for Jackies presale reminder (5 days)**
- OAuth2 per-client flow (token encrypted into `d2c_connections.credential_jsonb`). Mailchimp datacenter-aware host handling.
- Template authoring UI: preview with live event variables populated from the selected event.
- Schedule-send (not immediate) — Matas in the loop as approver before flag flip.
- This is the narrowest, highest-value slice. Jackies is already the biggest D2C time sink at 11 events/month.

**Phase 2 — Bird WhatsApp DM for Jackies presale reminder (5 days)**
- Jackies already uses Bird. Reuse the `d2c_connections` shape; Bird workspace-scoped key handling.
- WA template approval is the scary path. Start submissions to Meta WABA now if we want to hit this phase in May.

**Phase 3 — "Generate all comms for event X" draft flow (3 days)**
- Use the existing `d2c_templates` table as the source. Deterministic 10–12 comms draft per event, aligned to `presale_at` / `general_sale_at`. Copy-to-clipboard outputs for the channels we haven't flipped live yet (e.g. WA Community while WABA approval is pending).
- This is the "halve D2C time before any API" piece that yesterday's doc rightly called the highest-leverage move.

**Phase 4 — Meta WhatsApp Cloud API / Tech Provider status (2+ weeks, Meta-gated)**
- Kick off the application now if we're serious about May/June. Don't wait for Phase 1.

**Phase 5 — Hands-off mode for low-risk comms**
- Autoresponder + 24h presale reminder become auto-send once Phase 1/2 are stable per-client.

---

## 6. Claude embedded in the dashboard — still the vision

No change from yesterday on shape; what's changed is the surface is closer to hand:

1. **Per-event AI brief on open** — still not built. Candidate for a 5-day build once Phase 1 flags are flipped (because the signal is richer with live D2C / creative data).
2. **Creative performance classifier** — the Heatmap already computes `fatigued` counts per ad. The next step is auto-tagging via `creative_tags` based on 72h CPR decay, then surfacing "top 5 by past ROAS for this client" on template pick.
3. **Copy-angle generator embedded in Creatives step** — same as yesterday. See §4 Phase 2.
4. **D2C comms draft-all** — see §5 Phase 3.
5. **Weekly Monday brief** — unchanged from yesterday's plan, now realistically buildable because the event / campaign / spend / pacing data is all in one place.
6. **Artist tone-of-voice cache** — keyed by artist IG handle, refreshed monthly. Build alongside §4 Phase 2.

---

## 7. Priority-ordered roadmap — revised 90 days

Yesterday's roadmap had 10 items; 4 of them are now done or close. Here's the remaining list with revised estimates.

| # | Item | Est. effort | Status (22 Apr) | Unlock |
|---|------|-------------|-----------------|--------|
| 1 | ~~Event → campaign linkage in wizard~~ | — | **DONE (PR #8)** | Done |
| 2 | ~~Reporting v1 (event-level spend/CTR/CPR)~~ | — | **DONE — Creative Heatmap + /reporting + ticket pacing** | Done |
| 3 | ~~Fix `report-shares` unsafe cast~~ | — | **DONE (PR #9 — discriminated union)** | Done |
| 4 | Harden Creative Heatmap (client snapshot + table overflow) | 1 day | **In flight, `fix/heatmap-client-snapshot`** | UX quality on the flagship reporting surface |
| 5 | D2C Phase 1 — Mailchimp live for Jackies presale reminder | 5 days | Schema done (mig 030), flag off | First live "push from dashboard" comm |
| 6 | Canva/Bannerbear Phase 1 — Bannerbear live for 4TheFans fan-park statics | 5 days | Schema done (mig 031), flag off | First live "render from dashboard" asset |
| 7 | Claude copy-angle endpoint (wizard button, not chat) | 3 days | Not started | Kills chat iterate loop |
| 8 | CapCut overlay-text JSON export (event → clipboard) | 2 days | Not started | Removes biggest retyping step in video overlay workflow |
| 9 | D2C Phase 2 — Bird WhatsApp DM for Jackies | 5 days | Schema done, flag off, Bird WABA approvals pending | Biggest Jackies time save |
| 10 | "Generate all comms for event X" draft flow | 3 days | Tables ready, UX not built | Halves D2C time before full live |
| 11 | Weekly Monday brief (cron + Claude + email) | 3 days | Not started | Makes Mondays mechanical |
| 12 | Creative performance classifier → template ranker | 1 week | Heatmap produces the signal; tagger not wired | Starts "system learns" loop |
| 13 | Meta WABA Tech Provider application | admin + wait | Not started | Gate to scalable WA Community comms |
| 14 | Automated optimisation execution (background worker) | 1 week | Not started | Turns advisory rules operational |

**Week 1 (22–28 Apr):** item 4 plus the in-flight Task A/B/C enrichment (artist + venue + event activity) — close the reporting loop UX gaps and give the wizard richer per-event context.
**Week 2–3 (29 Apr – 12 May):** items 5, 6, 8 — flip the first two feature flags, land the CapCut JSON export alongside Bannerbear (same creative-step surface).
**Week 4 (13–19 May):** items 7, 10 — compound the earlier wins with AI copy + draft-all.
**Week 5–6 (20 May – 2 Jun):** items 9, 11 — WhatsApp Jackies + Monday brief.
**Week 7+ (Jun onward):** items 12, 14 — learn-and-execute loop. Item 13 runs in the background throughout.

Target: two live-flipped feature flags (D2C Mailchimp + Canva/Bannerbear) and a working Monday brief by end of May. That's the unlock for the £20k MRR conversation.

---

## 8. What to explicitly NOT build — unchanged, reinforced

- **Rebuilding Meta Ads Manager features.** Madgicx at $69/mo. Don't build.
- **Creative analytics from scratch.** Motion at $49/mo. We're running a Motion trial already — use it as spec input, don't clone it.
- **Our own ticketing platform.** Stay the agency on top of Dice/RA/Skiddle/Fatsoma.
- **A heavy CRM (Customer.io / Braze replacement).** We're building a templating + adapters layer, not lifecycle orchestration.
- **TikTok wizard before Meta feels finished.** Hardened.
- **Figma integration.** No design system or designer. Canva/Bannerbear covers it.
- **Client-facing self-serve dashboard.** Share tokens + read-only reports for 2026.

New addition: **don't build a "campaign auto-launcher" until the D2C comms are live and clients are used to receiving pushed outputs from the dashboard.** Order of operations matters — we need the dashboard to be the system of record for comms before we trust it to launch ads autonomously.

---

## 9. Sarah's growth path inside this plan — revised

Yesterday's framing holds up. Concrete revisions:

- **Reporting UI (item 2 — DONE):** Sarah should do the next-layer thinking now that the shape is live. What does the cross-event rollup need to look like for a client-facing share? What's the Looker Studio tie-in that maximises her expertise?
- **D2C templating engine schema (items 5, 9):** the per-client OAuth flows, credential encryption, and datacenter-aware Mailchimp handling all need careful data governance thinking. Native Sarah territory.
- **Governance layer:** consent / opt-in handling, GDPR-compliant audience segmentation, data protection for per-client API credentials. Becomes visible once D2C flips live — Sarah can own this as a service line.
- **"Dashboard-as-a-service" to other agencies:** once flags are flipping cleanly and we have two live-tenant stories, this becomes a pitchable commercial line. Sarah's technical-training background is the natural fit for onboarding other agencies onto the platform.

---

## 10. Operational learnings from the 22 April rate-limit ordeal

New section. These aren't strategy — they're the house rules that keep the build disciplined. Worth writing down.

1. **Don't curl-force the same Meta endpoint repeatedly during a debug session.** Meta's rate-limit bucket stays warm, and each subsequent trigger gets worse data. Push the fix, wait for the cron to run, read the logs.
2. **Sandbox egress is blocked for our own domains.** Cowork can't curl `app.offpixel.co.uk` or `vercel.com`. Any live-endpoint verification has to come from Matas's terminal. Codified in memory.
3. **`gh` CLI restored at `/usr/local/bin/gh` (22 April PM)** — authed via browser OAuth. Cursor prompts can again end with `gh pr create` + `gh pr merge --squash --delete-branch --auto`, which sets up auto-merge so PRs close themselves on green CI. If `gh` ever regresses, re-install by dropping the macOS arm64 zip binary into `/usr/local/bin` (which is on the default PATH for both zsh and Cursor's shell — `~/.local/bin` is not).
4. **Vercel Pro is the right call when the workload genuinely needs >300s.** The Hobby-plan pain wasn't about rate limiting — it was about our pagination burning budget via retry backoffs. Pro at £16/mo paid for itself the morning it went live.
5. **Feature-flag every risky integration.** Migration 030 and 031 both shipped this way. Nothing goes to a client until a flag flips per-client.
6. **Cowork vs Cursor split is real and working.** Cowork = strategy, research, prompt crafting, memory curation. Cursor = execution, git, PRs. Don't try to do git from Cowork; don't try to do roadmap thinking from Cursor.

---

## 11. Closing honest take — 22 April edit

Yesterday the concern was "build debt drift — half-shipped systems everywhere." 24 hours of disciplined shipping plus a hard-won Meta rate-limit lesson has shifted that concern.

The new risk is **flag inertia.** Having tables and adapters behind dry-run flags feels like progress, and technically it is — but it doesn't create client-visible value or revenue lift until one flag flips live for one client. Three scaffolded phases without a live phase is a worse position than one scaffolded phase with one live phase, because it fragments attention without producing proof.

Discipline for the next 30 days: pick the two narrowest flag-flips (Mailchimp for Jackies, Bannerbear for 4TheFans), execute them end-to-end, and *then* scaffold the next layer. Don't build Phase 2 of anything until Phase 1 of that workstream is live for a real client.

Attack creatives and D2C live-shipping in that order. Reporting UX cleanup lives in parallel because it's cheap and high-leverage. Don't touch multi-platform until Meta feels finished.

— End of reflection · 22 April 2026
