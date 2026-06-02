# Competitor workflow analysis — solo operator, 121 events, Cursor-native stack

**Source:** walkthrough video from a friend/competitor (UK event marketing, similar client mix — festivals, nightclubs, comedy, "erotic soiree"). Solo operator running 121 events end-to-end.

**Date:** 2026-05-20.

**Reviewer:** Matas / Commercial+Ops thread.

---

## What he's actually doing

Three Cursor windows, one role each:

1. **Client window** — every client repo open (websites, email-template HTML, per-client assets). Drives day-to-day execution.
2. **Internal projects window** — his own tooling. Remotion sits here (AI editor) generating creative-asset variations by city/script/hook.
3. **Skill library window** — `.md` skill files he authored that each wrap one ad platform's API. Six platforms. A single prompt sets up campaigns across all six.

Live demos shown in the video:

- Meta campaign for Day Zero built end-to-end from one prompt: campaign + ad set + retargeting audiences + placements + creative upload + caption + schedule.
- Eventbrite ticket-count pull live in the editor.
- Gmail integration drafting client contracts.
- Klaviyo sending WhatsApp messages in bulk.
- Email-from-Meta-skill: bullet-point performance report drafted into a Gmail draft.
- Remotion generating asset variations across cities with different scripts/hooks automatically.

His claim: **one person, 121 events, all from Cursor.**

He closed on: *"if you're not building up your own skill `.md` files you are going to lose."*

---

## Honest comparison — what he has that we don't, and vice versa

### Where he is ahead of us

**1. Six ad platforms with one prompt.**
We have Meta + TikTok + Google Ads shipped. He has six. He didn't name them but the implied stack is Meta + TikTok + Google + LinkedIn + Snap + Reddit or similar. For event marketing specifically the gap is probably Snap and Reddit; LinkedIn isn't useful for nightclubs.

*Impact for us:* low-to-medium. Our three platforms cover ~95% of event-marketing spend. But the *architecture* lesson is real — each new platform is one skill file, not a multi-month integration.

**2. Skill files as the primary primitive.**
He treats `.md` skill files as the unit of capability. We treat **PRs and wizard surfaces** as the unit. He can spin up a new capability in a session; we ship a PR over days/weeks.

*This is the biggest architectural delta.* Our `app.offpixel.co.uk` wizard model is heavier-touch — it has a UI, audit trails, share reports, the whole snapshot-cache architecture. His Cursor-and-skills model is lighter, faster to extend, but produces no client-facing surface (no share reports, no dashboards). Different bets.

**3. Remotion for automated creative variations.**
He generates asset variations across cities/scripts/hooks automatically. This is the **motion-replacement gap we explicitly haven't built yet** — the Bannerbear + Submagic + OpenAI path the strategic reflection flagged for 30-day arc, plus the autotag work that's been live since 2026-05-12.

We have:
- Creative tagging foundation (mig 061, autotag cron live since 2026-05-12).
- Plans/scoping for Bannerbear + Submagic + OpenAI (`docs/STRATEGIC_REFLECTION_2026-04-23.md`).
- **No actual variation-generation pipeline shipped.**

He has the thing we've been talking about building for two months, running in production for him today.

*Impact for us: HIGH.* This is the single largest practical capability gap.

**4. Klaviyo bulk WhatsApp send from the editor.**
We have Mailchimp + Bird/WABA in scope for the D2C thread but our flow is still "Matas drafts comms, then sends in the comms tool." He sends from Cursor directly.

*Impact for us:* medium. His flow is faster per-send; ours is more auditable. Probably both right for different volumes.

**5. Email-template HTML in the repo per client.**
He keeps client email templates as custom HTML versioned in the client repo. We don't — they live in Mailchimp.

*Impact for us:* low. Mailchimp templates are fine until they're not. Versioning them in-repo gives faster A/B iteration but adds maintenance.

**6. Gmail + Eventbrite live in the workflow loop.**
Gmail drafts contracts. Eventbrite ticket counts live in the editor. This is connector breadth applied to commercial tasks (not just campaign tasks).

*Impact for us:* low-to-medium. We have Xero, GitHub, Supabase, Meta MCPs in Cowork; we don't have Gmail or Eventbrite in the loop. We have Eventbrite in the app (`client_ticketing_connections.provider = 'eventbrite'`), just not in the chat loop.

### Where we are ahead of him

**1. Client-facing share reports.**
Our `share/report/{token}` surface — with snapshot caching, build-version invalidation, the whole architecture from PR #87 onward — is **client deliverable**. His Cursor workflow has no equivalent. He can run campaigns; he can't hand a client a live dashboard.

This is genuinely material commercially. The MoS pitch, the Ironworks venue dashboard, the 4thefans aggregate — these are revenue-generating deliverables in their own right. His stack doesn't produce them.

**2. Attribution rebuild — the moat.**
PR #424 (the dark-shipped attribution layer, three-source reconciliation, real vs Meta-claimed purchases) doesn't exist in his world. His Cursor-and-skills setup is for *operating* campaigns, not for *auditing* attribution. This is the actual MoS-prospect wedge.

**3. Reporting depth + funnel pacing.**
The 4thefans-style daily-tracker, venue-allocator, three-tier today-guarantee rollup — these are infrastructure that holds the whole reporting story together for multi-event clients. His walkthrough showed campaign setup, not reporting. He probably exports CSVs from Meta and hand-builds reports, like every other agency.

**4. Sarah's data infrastructure capability.**
Sarah's Looker/BigQuery/dbt grounding is a capability he likely doesn't have at all. This is the long-game diversification path — dashboard-as-a-service for non-event clients.

**5. Audit trails + rollback safety.**
Our PR-per-change discipline, branch ownership (`cc/` vs `cursor/`), session logs, snapshot caches, and the rules around the load-bearing invariants (`AD_INSIGHT_CHUNK_CONCURRENCY=1`, `CREATIVE_BATCH_SIZE<=25`, etc.) — these protect against catastrophic mistakes at scale. His one-prompt-six-platforms flow is faster but riskier; one bad prompt could ship six broken campaigns simultaneously.

For a 2-person agency growing fast, this matters more than it sounds.

### Where we are roughly even

- **Cursor-as-IDE.** Same primary tool, same primary model (Sonnet for most, Opus for diagnosis — assuming he uses Composer 2.5 similarly).
- **Skill files.** We use them (the Cowork skills system: pptx/xlsx/docx/etc + project-specific instructions). He uses them more aggressively per-platform.
- **Multi-window workflow.** Our 4-thread Cowork setup + Cursor worktrees mirrors his three-window Cursor model — different tools, same architecture instinct.

---

## What I'd take from this — three concrete adoptions

### 1. Build the creative-variation pipeline. This is the highest-leverage gap.

His Remotion-driven automated asset generation is operational today. We've scoped it three times (`STRATEGIC_REFLECTION_2026-04-23.md`, `COMPETITIVE_SCAN_BRIEF_TO_CAMPAIGN_2026-04-23.md`) and not shipped it. Every week we don't have it, he's producing 10× the creative volume per event for the same operator-time.

**Action:** treat Bannerbear + Submagic + OpenAI (or evaluate Remotion specifically — it's the tool he picked) as the next 30-day arc for the Creative thread. Not "research." Ship.

### 2. Build skill files per surface, not per PR.

Our model is: identify a need → PR → wizard surface. His model is: identify a need → skill `.md` → next prompt has the capability.

We should run **both** for different things. The wizard surface for things clients see; the skill file for things only we use. Right now we PR-ship a lot of internal tooling that should be skill files.

**Action:** when a Cursor or Cowork session needs a new internal capability (e.g., "generate the weekly client report from Meta + TikTok + Google MCPs"), ship it as a skill file (committed to `/skills/` in the repo or as a Cowork plugin) rather than a UI route. Faster iteration, no maintenance debt.

### 3. Eventbrite + Gmail in the Cowork loop.

He has Eventbrite ticket counts and Gmail drafts live in his editor. We have Eventbrite *in the app database* but not in the Cowork conversation. We don't have Gmail at all in Cowork.

**Action:** check the connector registry for Eventbrite + Gmail MCPs. Both would shorten the per-event briefing + comms-drafting loop materially. (Note: I see Gmail MCP tools are already loaded in this conversation — `create_draft`, `search_threads`, `label_*` — so we may already have it. Verify and use.)

---

## What I would NOT copy

**1. Abandon share reports / dashboards.**
He doesn't have client-facing deliverables. We do, and they're a commercial differentiator. The MoS attribution pitch, the Ironworks venue dashboard, the 4thefans aggregate — these are billable surfaces. Don't trade them for raw speed.

**2. Adopt his one-prompt-six-platforms risk profile.**
At our scale and growth trajectory, an audit trail and rollback discipline matters. He's a solo operator at 121 events — if he ships a broken campaign across six platforms, he eats the loss alone. We have Sarah, we have client contracts, we have the Boiler Room engagement. Bias toward the safer architecture even if it's slower.

**3. Skip the attribution rebuild.**
This is our actual moat. He doesn't have it; OnSocial sort of does. The Off/Pixel-as-attribution-product wedge (`project_offpixel_attribution_product_wedge_2026-05-15`) is more defensible than "fastest Cursor agency" ever will be.

---

## Sanity-check on his "121 events solo" claim

Worth being slightly sceptical. 121 events is a lot. A few questions the video doesn't answer:

- Does "responsible for" mean *running the paid media on* or *touching in any capacity*? Most agencies inflate this.
- What's the average budget per event? At £600 small-promoter level, 121 events is plausible for a solo if the templates are tight. At £10k+ per event he'd be drowning regardless of Cursor.
- What's his actual cycle time per event end-to-end? "One prompt sets up a campaign" hides a lot — asset prep, audience research, client back-and-forth, reporting.
- No mention of reporting depth, attribution, or anything client-facing beyond contracts. If he's not delivering structured client reports he's competing in a different tier.

He's clearly fast at *campaign setup*. He may not be doing the rest of the agency job at the same level — or may be doing it less, on purpose, because his clients buy operator-speed not depth.

We sell something different. The comparison helps as a tooling benchmark, not a strategy template.

---

## Net read

He is ahead on **creative-variation automation** (the Remotion gap is real and material) and on **skill-file-as-primitive discipline** (we over-PR things that should be skills).

We are ahead on **client-facing reporting**, **attribution depth**, **audit safety**, and **the productisation arc** (attribution-as-product, dashboard-tier pricing).

The single most valuable adoption is **shipping the creative-variation pipeline this month**, treating it as a hard 30-day arc not a research thread. Second is **building more skill files instead of more wizard routes** for internal tooling.

Don't trade our differentiators for his speed. Take the creative gap closed; keep the depth.
