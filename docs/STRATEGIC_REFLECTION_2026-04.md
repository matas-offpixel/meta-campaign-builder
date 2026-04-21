# Off/Pixel — Strategic Reflection & Roadmap

**Date:** 21 April 2026
**Business age:** ~2 months (founded 22 Feb 2026)
**Snapshot:** ~£13k MRR, 8 clients, 1 dashboard product, 0 D2C automation, 0 creative automation

This document is a reflection on where the dashboard and campaign tooling are, what's been done well, what's been underbuilt, and — most importantly — how to attack the two biggest remaining time sinks: **creative production** and **D2C comms orchestration**. It assumes you've already read CLAUDE.md / AGENTS.md / PROJECT_CONTEXT.md and doesn't repeat that content.

---

## 1. Milestones — where we actually are

The documented project scope (CLAUDE.md) has drifted behind reality. The repo has grown beyond "Meta campaign wizard" and is already closer to an agency OS skeleton than the docs suggest. For the record, here's what the audit actually found:

### Shipped and solid

- **Full 8-step Meta wizard** — account → campaign → optimisation → audiences → creatives → budget → assign → review/launch. No stub steps. Audience panel alone handles Page engagement audiences, Custom Audiences, Saved Audiences, Interest groups, lookalike seeding with % and range, interest validation and deprecation fallback.
- **Meta API end-to-end** — `lib/meta/{client,campaign,adset,creative,upload}.ts` plus the matching `app/api/meta/*` routes. Launch pipeline has phased error recovery, lookalike retry logic, interest sanitisation with cluster-based replacement.
- **Data model that anticipates the agency OS** — Supabase schema already includes `clients`, `events` (with `event_date`, `event_start_at`, `event_timezone`, `presale_at`, `general_sale_at`), `venues`, `artists`, `event_artists` junction, `creative_tags`, `audience_seeds`, plus `campaign_drafts` / `campaign_templates`. Migrations 003–020 show this grew organically. Your model is further ahead than the doc.
- **Persistence + schema evolution** — dual-layer (localStorage + Supabase), `migrateDraft()` handles forward-compat on load. This is mature engineering, not prototype code.
- **Auth** — magic link + invite allowlist, RLS per user, three-client Supabase setup (browser/server/proxy). Solid.
- **Shared report tokens** — client-facing share surface exists (`/api/share/report/[token]/*`) with tables and routes, even if the UI layer is thin.

### Partially built (skeletons — needs UI and plumbing)

- **Event / client / venue / artist UI** — routes exist (`/api/events`, `/api/clients`, `/api/artists`, `/api/venues`) but the dashboard doesn't surface them. The wizard has FKs (`client_id`, `event_id`) but doesn't populate them from a real event picker. This is the single biggest "almost there" area.
- **Reporting surface** — TikTok report import (`/api/tiktok/import`), Meta spend tracking (`/api/meta/campaign-spend`), Google Ads scaffolding, creative insights endpoint (`/api/intelligence/creatives`). All of this returns JSON; none of it has a UI. The loop is unclosed — you can launch but you can't see.
- **Invoicing** — table exists (migration 019), routes return 501. Quote generator is built (`offpixel.co.uk/quote`) but decoupled from the app.
- **TikTok / Google Ads** — schema + some routes, no wizard surface, no unified abstraction. If you want multi-platform one day, you're paying the "platform-specific silo" cost already.

### Missing entirely (the strategic gaps)

- **Comms / D2C layer** — zero. No email, SMS, WhatsApp, Mailchimp, Klaviyo, Bird, or templating engine. This is the biggest operational time sink in the business and has zero product surface.
- **Creative library / Canva / Figma integration** — zero. The Creatives step accepts manual uploads only.
- **AI-driven creative or copy variations** — types exist for `AssetVariation` and `CaptionVariant` but no generator, no Claude-side variant engine, no artist tone-of-voice caching.
- **Automated optimisation execution** — rules are configurable but no background worker pauses/scales ad sets based on CPA/ROAS thresholds. This means your "optimisation strategy" step is advisory, not operational.
- **Asset tagging + retrieval by event/artist** — `creative_tags` exists but there's no UI for browsing past-event creatives.

---

## 2. Things done well — and what to stop worrying about

Be honest with yourself: these are legitimately good decisions that most agencies don't make in month two.

1. **The schema is thinking further ahead than the UI.** Clients / events / artists / venues all exist as proper entities with FKs, not as free-text strings on a campaign. This is the load-bearing decision that makes everything downstream — reporting, D2C, invoicing, client portal — possible without a rewrite.
2. **RLS per user from day one.** When Sarah is full-time and a junior eventually joins, you won't be retrofitting auth.
3. **Error recovery on Meta launches is genuinely production-grade.** The lookalike retry + interest sanitisation + phased launch summary is the kind of thing that normally gets built after a painful outage, and you built it pre-emptively.
4. **Shared report tokens exist.** Client-facing reporting surface is half-built structurally — when you're ready to flip it on, you don't start from scratch.
5. **Dual-layer persistence + `migrateDraft()`.** Autosave works offline-ish and schema changes don't orphan drafts. That's a better engineering posture than most internal tools.

Stop treating these like "basics." They're not. They're why we can actually build on top.

---

## 3. Things to improve — and brutal honesty

### 3a. The reporting loop is the single biggest strategic miss right now

You have 8 clients and growing. You're selling campaigns with optimisation strategy baked in. But **you can't currently show a client a live campaign view from inside the dashboard** — you're still going to Meta Ads Manager, Looker Studio, or exported sheets for that story. Every week you don't ship reporting, the dashboard's perceived value to clients is lower than its actual cost to you.

The fact that the backends (`/api/meta/campaign-spend`, `/api/insights/event/...`, `tiktok/reports`) already exist makes this worse, not better: you've paid the schema + integration cost but aren't realising the retention / upsell value.

**Fix:** before anything else in this doc, ship one reporting page — event-level spend/CTR/CPR — even if it's ugly. It'll instantly change client conversations.

### 3b. The wizard isn't yet connected to events

You modelled events properly, but a user creating a campaign still types in names, dates, and launch windows by hand rather than picking an event that already exists. That means:

- The same event data is re-entered per campaign per platform
- Reporting across campaigns for one event requires manual stitching
- D2C can't reuse event metadata (because it isn't the source of truth yet)

**Fix:** Step 0 should be "pick a client → pick an event" and auto-populate downstream. This is a 1–2 day piece of work that compounds later.

### 3c. Multi-platform is half-laid

TikTok and Google Ads have tables but no unified "Campaign Brief" abstraction that fans out to platforms. If you keep building per-platform silos, you'll be refactoring in 6 months when a client says "run this across Meta + TikTok."

**Fix (non-urgent but decide soon):** either commit to Meta-only for 2026 H1 and rip out the TikTok/Google stubs, or commit to a `CampaignBrief` abstraction and build the TikTok wizard step with the same data model. Having both half-built is worse than either choice.

### 3d. Known latent issues flagged in memory

- **`report-shares` unsafe cast** — when you mint client-scoped shares, the `as ResolvedShare` cast will crash on null `event_id`. Fix before the first external client demo.
- **Facebook reconnect short-lived token** — extendToken failure on reconnect (being fixed in Cursor).

---

## 4. The creative time sink — attack plan

### What's actually happening today

From cross-session patterns, your creative workflow has a consistent shape:

1. **Asset sourcing** — scrape artist IG/TikTok or pull from press kit folders
2. **Tone-of-voice extraction** — reverse-engineer artist/client IG captions for voice
3. **Copy generation** — 3–4 angles per creative (FOMO, urgency, atmosphere, POV)
4. **Overlay production** — CapCut for UGC/video, Photoshop for static templates
5. **Iterate-to-lock** — 3–5 turns of refinement per creative set

Steps 2 and 3 are already partially in Claude. Steps 1 and 4 are the actual bottleneck.

### Competitive landscape

The creative automation space is crowded but none of it is built for your context:

| Tool | What it does | Cost ref | Fit for you |
|------|--------------|----------|-------------|
| **AdCreative.ai** | Template-driven static ad variations with AI copy | $39–$599/mo | Too consumer-brand-focused, no event rhythm understanding |
| **Pencil / pencil.ai** | AI video ad generation from product assets | Hidden pricing | Product-centric; weak for artist/venue content |
| **Creatopy** | CSV → hundreds of display ad variations | Mid-tier SaaS | Strong for display, not social-first |
| **Smartly.io** | Enterprise creative automation, 5k+ variations | Enterprise ($$$$) | Out of budget, overkill |
| **Arcads** | AI UGC avatars for TikTok/Reels-style ads | $110–$220/mo | Interesting — might replace sourcing real creators for low-budget shows |
| **Motion** | Creative analytics across Meta/TikTok/etc | $49/mo+ | **Worth subscribing to for benchmarks alone** |
| **Canva Connect API** | Autofill templates with JSON → PNG/MP4 | Included w/ Teams | This is the actual build target |

### The plan — Canva-first, Claude-native creative engine

Given your answers (Canva + Mailchimp-first), here's the specific build:

**Phase 1 — Canva Connect integration (2 weeks of focused dev)**
- Add a `client_brand_templates` table: per-client Canva brand template IDs, mapped to autofill field names (`{artist_name}`, `{venue}`, `{date}`, `{ticket_link}`, `{hero_image_url}`, `{sold_tier}`)
- New wizard sub-step "Creatives → Generate from template": pick template, confirm autofill payload, fire Canva job, poll for render, attach to creatives
- Canva requires Enterprise for Autofill API — add this cost into your quote model (you can pass it through or absorb it against the time saved)
- Fallback: **Bannerbear** ($0.05–$0.20/render) for high-volume per-artist fan cards at festivals like Junction 2

**Phase 2 — Claude-native copy engine (1 week)**
- Move the "3–4 angles" caption generation out of chat into a deterministic endpoint: `/api/creative/copy-angles` that takes `{event_id, artist_id, angle: "fomo"|"atmosphere"|"urgency"|"pov"}` and returns 3 variants
- Cache artist tone-of-voice per `artist_id` in Supabase (first call scrapes IG via Chrome MCP, stores, reuses)
- Auto-surface "use template from KINYXX event" when doing a similar show — reuse winning variants

**Phase 3 — CapCut stays, but thinner (defer)**
- Keep CapCut for UGC video overlays; don't try to rebuild video editing
- Build an "overlay copy pack" export: from the wizard, one click exports all overlay text as a structured JSON/CSV that you paste-load into CapCut's text elements. Kills the manual retyping step.

**What's actually ownable here vs off-the-shelf:** event-rhythm-aware creative generation. None of Creatopy/Smartly/AdCreative understand that a creative for "announcement phase" looks different from "final tickets phase." Your system knows, because the campaign wizard knows.

---

## 5. The D2C time sink — attack plan

### What's actually happening today

Pattern from ~10 session transcripts: every event produces **10–12 comms** in a repeating structure:

| Phase | Channels | Typical count |
|-------|----------|---------------|
| Autoresponder (on signup) | Email + WhatsApp | 2 |
| Announcement mailer | Email | 1–4 (per city) |
| Presale reminder (24h before) | Email + WA DM + WA Community | 3 |
| Presale live | Email + WA DM + WA Community | 3 |
| General sale live | Email + WA DM | 2 |
| Urgency / final tickets | Email | 1–2 |

That's **10–12 pieces of comms × 11 Jackies events / month = 110+ individual comms per month for one client**. The structure is deterministic. The variables (event name, date, venue, sold %, positioning line, ticket link) are a small finite set.

This is the single biggest automation opportunity in the entire business.

### Competitive landscape

| Tool | API maturity | Multi-tenant story | Fit |
|------|--------------|--------------------|------|
| **Mailchimp** | Full Marketing API, OAuth2 | Agency-friendly via OAuth2, datacenter-aware host | **Best first target** — most clients already here |
| **Klaviyo** | Strongest event-industry fit, native "event purchased" triggers | OAuth2 GA | Push to new clients; migrate where possible |
| **Bird (ex-MessageBird)** | Channels API for SMS + WA + email | Workspace-scoped keys | Jackies uses this — needed for WhatsApp DM scheduling |
| **WhatsApp Cloud API (Meta direct)** | Official, template-gated | Tech Partner route for multi-client | Required for WhatsApp Community comms at scale |
| **Firetext** | Simple UK SMS | Per-client key | Niche — only if client insists on SMS |
| **Twilio Subaccounts** | Cleanest multi-tenant | Subaccount per client | Great fallback if Bird gets complicated |

### The plan — templating engine first, then provider adapters

**Phase 1 — Comms templating layer (2 weeks)**

Build the engine **inside** the dashboard before any API integration. This is the "templating before integrations" path.

- New tables: `comms_templates` (phase, channel, body, subject, variable schema), `comms_campaigns` (event_id → array of scheduled sends), `comms_variables` (per-event computed values: sold %, ticket link, positioning line)
- Template model uses liquid-style `{{event.name}}` / `{{artist.primary}}` / `{{sold_tier}}` — same variable schema as Canva autofill, so Canva templates and Mailchimp templates share variables
- "Generate all comms for event X" wizard: picks the event, computes all 10–12 comms as drafts, shows you a calendar preview aligned to `presale_at` / `general_sale_at`
- Output modes: copy-to-clipboard per comm (for today's manual flow), export-as-CSV, future API send

This alone — before any API push — will probably halve your D2C time. You stop writing the scaffolding.

**Phase 2 — Mailchimp adapter (1 week)**

- OAuth2 per-client connection stored encrypted in `client_integrations`
- Push scheduled Mailchimp campaigns from the dashboard with subject + body + scheduled send time
- Still human-approved before send (don't auto-fire), but one click instead of 12 re-creations in Mailchimp UI

**Phase 3 — WhatsApp Cloud API (2 weeks — deeper because of approval gate)**

- Apply to become a Meta Tech Provider (you already run a Meta app for ad management; adding messaging API is mostly paperwork)
- Embedded signup so clients can connect their WABA
- WA template approval workflow: draft in dashboard → submit to Meta → track approval → use in campaign
- Warning: Meta is slow here (weeks). Start this early if you're serious.

**Phase 4 — Bird + Firetext adapters (1 week each, on demand)**

Only build when an existing client (Jackies = Bird) needs it. Don't pre-build.

**Phase 5 — Hands-off mode (aspirational)**

Once Phases 1–3 are stable, add "scheduled auto-send" for low-risk comms (autoresponder, presale reminder 24h) gated by event launch window. You stay in loop for announce / general sale live.

### What's ownable here vs off-the-shelf:
- **Event-phase awareness**: no CRM natively understands announce/presale/onsale rhythm
- **Cross-channel template sharing**: same variables drive Canva, Mailchimp, WhatsApp
- **Source-of-truth events**: client/event data flows from the dashboard, not duplicated in each CRM
- **Agency multi-tenant**: one dashboard, many clients' CRMs — no existing tool does this for events

---

## 6. Claude embedded in the dashboard — the vision

You asked for Claude to be "more embedded in the app to empower insights, efficiency, performance." Concrete ways:

1. **Per-event AI brief on open** — when you open an event in the dashboard, Claude (via Agent SDK sub-agent) pre-computes: "This event is 3 weeks out, sold at 34%. Pacing vs similar past events = -12%. Recommended: shift Louder template budget toward cold prospecting, refresh creatives with urgency angle." One call, one card, visible.
2. **Creative performance classifier** — tag creatives with `creative_tags` automatically from Meta insights: "this creative underperformed on CPR after 72h." Next time you pick templates, surface the top 5 by past ROAS for this client.
3. **Copy-angle generator embedded in Creatives step** — not a chat. A button that produces 4 pre-framed variants with "why" explainer per angle.
4. **D2C comms draft-all** — on event creation, Claude drafts the full 10–12 comms pack with variables filled. You review, approve, push.
5. **Weekly Monday brief** — on Mondays at 9am (you planning day), auto-generate: "Here are this week's 14 events across clients. Here's what needs creative refresh. Here's what's pacing poorly."
6. **Artist tone-of-voice cache** — keyed by artist IG handle, refreshed monthly. Reused across events.

All of these are Agent SDK patterns the dashboard can call internally. None of them require a chat UI in the product — they run silently and surface results.

---

## 7. Priority-ordered roadmap (next 90 days)

Given £13k MRR → £20k target, 2 operators, no hiring, here's the priority-ordered list. Each item lists the unlock.

| # | Item | Est. effort | Unlock |
|---|------|-------------|--------|
| 1 | **Event → campaign linkage in wizard** (Step 0 picks client+event, auto-populates) | 2 days | Every downstream feature |
| 2 | **Reporting v1** — one event-level page (spend/CTR/CPR over time) using existing `/api/meta/campaign-spend` | 3 days | Client-perceived value jumps |
| 3 | **Fix `report-shares` unsafe cast** (latent crash) | 0.5 day | Unblocks client-facing share links |
| 4 | **Comms templating engine (Phase 1)** — tables + "generate all comms" UI + copy-to-clipboard output | 2 weeks | Halves D2C time before any API |
| 5 | **Canva Connect integration (Phase 1)** — client brand templates + autofill generator | 2 weeks | Kills Photoshop for statics |
| 6 | **Claude copy-angle endpoint** in Creatives step (not chat) | 1 week | Kills chat iterate loop |
| 7 | **Mailchimp adapter + OAuth2** | 1 week | First "push from dashboard" channel |
| 8 | **Weekly Monday brief** (cron + Claude + email) | 3 days | Makes Mondays mechanical |
| 9 | **WhatsApp Cloud API via Tech Partner** | 2 weeks (+ Meta approval wait) | Biggest Jackies time save |
| 10 | **Creative tag performance surface** — "best past creatives for this client" | 1 week | Starts the "system learns" loop |

Weeks 1–2: items 1, 2, 3 → close the reporting loop, unblock everything.
Weeks 3–5: items 4, 5 → crush the two biggest time sinks.
Weeks 6–9: items 6, 7, 8 → automate the repetitive layer.
Weeks 10–12: items 9, 10 → start the "hands-off" vision in earnest.

---

## 8. What to explicitly NOT build

Opportunities that are tempting but wrong-fit right now:

- **Rebuilding Meta Ads Manager features (bid adjustments, creative rotation).** Madgicx at $69/mo does this. Subscribe, don't build.
- **Creative analytics from scratch.** Motion at $49/mo has benchmark data from $1.3B of spend. Subscribe, don't rebuild.
- **Your own ticketing platform.** Dice/RA/Skiddle/Fatsoma are platform plays. You're an agency on top of them. Stay there.
- **A heavy CRM (Customer.io / Braze replacement).** You just need a templating layer + push adapters, not lifecycle orchestration.
- **TikTok wizard before reporting is live.** Don't add platforms until the first one feels finished.
- **Figma integration.** You don't have a design system or a full-time designer. Canva covers it.
- **Client-facing self-serve dashboard.** Share tokens + read-only reports are enough for 2026.

---

## 9. Sarah's growth path inside this plan

You said you want Sarah's role to grow. The build above gives her natural surface:

- **Reporting UI (item #2)** — Looker Studio / BigQuery background makes her the right owner of the data backbone and the first reporting surface
- **D2C templating engine schema (item #4)** — data modelling and event/comms variable schema design is her wheelhouse
- **Governance layer** — consent/opt-in handling, GDPR-compliant audience segmentation for D2C, data protection for client integrations → she can own this as a visible service line
- **Dashboard ops service line** — once this internal tool stabilises, selling "dashboard-as-a-service" to other agencies or promoters is the commercial expansion you've talked about

Sarah's revenue contribution becomes legible when her layer is visibly what makes the whole thing work.

---

## 10. Closing honest take

Two months in, the engineering posture is well ahead of the revenue scale. That's not a problem; it's an asset — assuming the next 90 days close the loop between "powerful internal tooling" and "client-visible value."

The two biggest risks right now:
1. **Build debt drift.** Starting TikTok before finishing Meta reporting. Building D2C adapters before finishing templating. The dashboard becomes a graveyard of half-shipped systems.
2. **Revenue ceiling without leverage.** £13k MRR at 2 operators is comfortable but fragile. The only path to £20k without hiring is the automation this doc describes. Every week the comms engine isn't built, you're paying for it in hours you can't scale past.

Attack creatives and D2C in that order. Ship reporting in between. Don't touch multi-platform until Meta feels finished.

— End of reflection
