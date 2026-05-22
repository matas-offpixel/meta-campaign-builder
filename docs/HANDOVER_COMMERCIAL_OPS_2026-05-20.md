# Commercial+Ops handover — v2 thread boot (2026-05-20)

Paste this into the fresh Commercial+Ops thread. The previous thread ran the full attribution-rebuild arc + Ironworks close + finance/VAT work and is now context-heavy. Memory was consolidated 2026-05-20 (index re-sectioned, 9 dated activity logs retired) — it loads clean.

## Who / what

Off/Pixel — 2-person UK event-marketing agency (Matas + Sarah, founded 22 Feb 2026). ~£13k MRR → £20k target. Repo `meta-campaign-builder`, live app `app.offpixel.co.uk`. Three-tool execution model: Cowork = strategy/prompts/MCP-ops; Cursor = execution; Claude Code = single-file fixes. See `docs/EXECUTION_TOOLING_2026-05-11.md`.

## LIVE open threads (priority order)

### 1. Real attribution layer — GATED ON JOE (4thefans dev)
- PR #424 shipped dark 2026-05-20. Migrations 093 + 094 applied to prod. Three matching tables empty (expected).
- Both feature flags default OFF (`OFFPIXEL_REAL_ATTRIBUTION_ENABLED`, `OFFPIXEL_LEGACY_ATTRIBUTION_TILE`). PR #422's broken tile is hidden.
- **Waiting on:** Joe's reply to the 5-fix email (sent 2026-05-18). He'll accept the assumed webhook payload shape.
- **Still to send Joe:** webhook URL (`/api/webhooks/ticketing/fourthefans`) + HMAC signature scheme + a click-capture script tag for fourthefans.tv landing pages. The `track.js` snippet is NOT built — only the endpoint. That's a half-day Cursor Sonnet PR when Joe's ready.
- Flag-flip runbook + full detail: memory `project_real_attribution_reconciliation_2026-05-20.md` + `docs/REAL_ATTRIBUTION_ARCHITECTURE.md`.
- **Buildable now without Joe:** run `/api/admin/backfill-meta-purchase-split` to populate `meta_purchases`/`meta_leads` for last 90 days (gives the "Meta claims X" number a baseline).
- **Watch:** matcher cron runs 4×/day on empty tables until Joe ships — confirm it exits cheaply or drop to weekly.

### 2. Ministry of Sound — audit response pending
- Demo is an ARCHITECTURE pitch (not live data): "here's what we built, here's what it shows once your ticketing ships email-capture; MoS owns funnel via Dice — same dark-build pattern." Pair with the 5-fix sheet.
- PR #422 capi_missing screenshot (Shepherd's Bush 0/61) saved as demo asset before going dark.
- Matas's 2025 MoS-rebuild involvement is the credibility wedge vs OnSocial's competing bid. Memory: `project_offpixel_attribution_product_wedge_2026-05-15.md`.

### 3. Ironworks — onboarding (just closed 2026-05-20)
- £20,200 base, 7 events (Fri 2 Oct → Sun 1 Nov 2026) + venue always-on. £110k total marketing budget, £85k paid spend through CLIENT's own BM (no VAT issue). 75/25 payment (£15,150 / £5,050). SEO + sell-out bonus traded out to hit budget — don't anchor future quotes on £20,200.
- Next: onboard into dashboard, set up event rows, brief intake.

### 4. Kick Off Club — onboarding in flight
- London WC26 fanzone, 3 venues, Skiddle ticketing (new build). Tier 2 target. 10 tweaks pending on v0 project-instructions doc before commit (Task #85).
- Launch Meta ads this week WITHOUT waiting for Skiddle infra (Task #89). Skiddle API spike is a half-day Claude Code job (Task #86).

### 5. PR #421 — tracking-health tier proposal (open, docs-only, awaiting review)
- Plan PR — stays open, do NOT auto-merge. The attribution tile (PR #424) is Bucket A item #2 of this proposal.

## Pending Cursor/Claude Code queue (from prior thread)
- Perf: PR-G cron-event-parallelism, PR-H per-account-meta-semaphore (both [Cursor, Sonnet], Task #51/#52).
- DOM smoke tests (#71, in flight), cron health monitor (#72) — [Claude Code, Sonnet].
- Week 2-3: allocator strategy registry (Opus), admin backfill consolidation (Sonnet), onboarding wizard (Opus).

## Finance state
- VAT registered, dating to 22 Feb 2026 inception. Robert handles returns (next ~7 Jun).
- Open cash-hygiene: transfer £1,417 Main GBP → VAT Reserve (#90), categorise 5 Revolut expenses to Xero (#92), audit Revolut card funding sources (#93).
- Subscriptions ~£362/mo, target hold £350-400. Anthropic API $50/mo cap to set (#94).
- Full tax/SIPP/Sarah/wine strategy: memory `project_offpixel_strategic_handover_2026-05-13.md`.

## Behavioural reminders (carried from memory)
- No hand-wave on number mismatches — query source-of-truth first.
- Cursor "all green" ≠ ground truth — cross-check Meta MCP on the highest-impact metric before merging dashboard PRs.
- Respect PR-author merge intent — "leave open" PRs are not auto-merged.
- Repo has no branch protection, so `gh pr merge --auto` doesn't fire — use plain merge or the merge_pull_request MCP.
