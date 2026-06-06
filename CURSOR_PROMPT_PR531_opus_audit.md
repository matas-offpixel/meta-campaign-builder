[Cursor, Opus] PR #531 — WC26 dashboard truth alignment audit (8 surfaces, AUDIT-ONLY)

## Mission

The 4thefans dashboard is drifting from source-of-truth across multiple surfaces. 6 patch PRs (#481, #483, #491, #493, #494, #495, #530) have closed individual symptoms but new ones keep appearing. Per memory `feedback_audit_first_when_layered_fixes_emerge`, this PR is AUDIT-FIRST.

**Critical new finding from 2026-06-04 session:** when client reviewed daily ticket-sales numbers per fixture, our portfolio daily-delta on Manchester showed +43 on Jun 4 but that's our own manual topup row inserted earlier today — not real sales. The daily-tracker is contaminated by reconciliation writes. This is on top of the spend-attribution drifts already known.

**Read these memory files before starting (do not skip):**
- `feedback_no_handwave_when_numbers_dont_match.md`
- `feedback_audit_first_when_layered_fixes_emerge.md`
- `feedback_verify_premises_before_mega_prompts.md`
- `feedback_no_fallback_papering_over_broken_source.md`
- `feedback_layered_fix_pattern.md`
- `feedback_ticket_sales_snapshots_cumulative_not_delta.md`
- `project_creator_canonical_builder_convergence_scope.md`
- `project_creator_daily_tracker_phantom_attribution_2026-05-21.md`
- `project_dashboard_venue_allocator_three_tier.md`

## Verified source-of-truth (2026-06-04, Cowork-side Meta MCP + client cross-check)

These are the ground-truth values per venue. DO NOT re-verify against Meta MCP — already done. These are the audit baseline:

| event_code | Lifetime Meta spend | Lifetime tickets | Lifetime CPT |
|---|---|---|---|
| WC26-ABERDEEN | £3,257 | 356 | £9.15 |
| WC26-BIRMINGHAM | £4,159 | 281 | £14.80 |
| WC26-BOURNEMOUTH | £3,987 | 619 | £6.44 |
| WC26-BRIGHTON | £8,836 | 2,683 | £3.29 |
| WC26-BRISTOL | £3,817 | 584 | £6.54 |
| WC26-EDINBURGH | £7,801 | 4,278 | £1.82 |
| WC26-GLASGOW-O2 | £6,478 | 1,397 | £4.64 |
| WC26-GLASGOW-SWG3 | £2,854 | 3,389 | £0.84 |
| WC26-LEEDS | £3,776 | 354 | £10.67 |
| WC26-LONDON-KENTISH | £4,565 | 229 | £19.93 |
| WC26-LONDON-ONSALE | £2,145 | umbrella | n/a |
| WC26-LONDON-PRESALE | £878 | umbrella | n/a |
| WC26-LONDON-SHEPHERDS | £2,080 | 86 | £24.19 |
| WC26-LONDON-SHOREDITCH | £2,954 | 679 | £4.35 |
| WC26-LONDON-TOTTENHAM | £1,847 | 61 | £30.28 |
| WC26-MANCHESTER | £10,423 | 1,001 | £10.41 |
| WC26-MARGATE | £1,968 | 166 | £11.86 |
| WC26-NEWCASTLE | £3,951 | 231 | £17.10 |
| **TOTAL** | **£75,815** | **16,394** | **£4.62** |

## 8 surfaces to audit

For each surface document:
1. Data flow trace (5 lines max — file → helper → render)
2. Current rendered value for **WC26-EDINBURGH** (cleanest venue: dashboard £7,346 vs truth £7,801)
3. Drift origin (specific function + line number — DO NOT guess, grep)
4. Fix shape (patch / refactor / architectural)
5. Estimated PRs needed

### Surface 1 — Topline / Internal dashboard headline
Portfolio-level KPI band at `/clients/[clientId]`. Total spend, total tickets, blended CPT.

**Audit questions:**
- Which helper aggregates portfolio-wide spend? `sumLifetimePaidMediaSpend` from `lib/dashboard/`?
- Does it iterate `event_daily_rollups.ad_spend_allocated` or use a different source?
- Does it include `[WC26-LONDON-PRESALE]` £878 + `[WC26-LONDON-ONSALE]` £2,145 umbrella spends?
- Current portfolio total vs truth £75,815 — surface the drift £.

### Surface 2 — Venue Report (individual event page)
Per-event detailed view at `/clients/[clientId]/venues/[event_code]`.

**Audit questions:**
- Which helper reads spend for a single venue?
- For Glasgow O2, does it apply `getSpendAdjustmentGbp` from `event-code-adset-splits.ts` (refreshed in PR #530)?
- For London-Presale (truth £878, dashboard likely £0), is there a DB event mapped to that event_code?
- For Brighton (truth £8,836, dashboard ~£7,113), where does the £1,723 go? Raw `ad_spend` per fixture is £6,744 (matches Meta) — gap is in the allocator step.

### Surface 3 — Performance Summary table
`components/share/client-portal-venue-table.tsx`. Per-venue rows with sell-through %, lifetime CPT pill, click→LPV rates.

**Audit questions:**
- Per-row spend source — `lifetimeMetaByEventCode` cache or per-row aggregation?
- Does `applyAdsetSplitsToLifetimeMeta` adjust spend or only reach/clicks/LPV?
- Relationship to `getCanonicalEventMetrics` (PR #418)?

### Surface 4 — Funnel Pacing
`components/share/` funnel pacing card (PR #484-#489 scope).

**Audit questions:**
- Which builder produces the funnel? `buildVenueCanonicalFunnel`?
- Does it accept `spendAdjustmentGbp` for Glasgow?
- Multi-fixture venues: per-fixture spend summed correctly or duplicated fanout?
- Does spend aggregation follow `aggregateSharedVenueCapacity` shape (MAX-or-SUM by mode)?

### Surface 5 — Daily Tracker / Daily Sales delta (NEW PRIORITY)
The per-day ticket sales display surfaced in client reports.

**Audit questions:**
- Where does "tickets today" come from? Per `project_creator_daily_tracker_phantom_attribution_2026-05-21`, the builder derives `tickets_today = cumulative_diff` between snapshots — which makes reconciliation writes appear as fake daily sales.
- Manchester 2026-06-04 shows daily delta +43 = our own manual topup, NOT real sales. Is this surfaced anywhere client-facing? Confirm yes/no for each render path.
- Does ANY surface use `ticketing_purchase_events` (per-order timestamps) for true per-day order count? If not, propose how to switch.
- For Edinburgh on 2026-06-03, what does the daily-delta reader return vs what `ticketing_purchase_events` shows for that calendar day?

### Surface 6 — Per-day spend (Meta daily)
`event_daily_rollups.ad_spend` and `ad_spend_allocated` per-day reads.

**Audit questions:**
- For Aberdeen on 2026-06-04, what daily spend does each surface show? Compare across Topline, Venue Report, Performance Summary, Funnel Pacing.
- Does the live cron's 60-day window cap (PR #481) silently truncate historical days from any reader?
- For the 7 PRESALE-overlap venues (Aberdeen, Birmingham, Bournemouth, Bristol, Edinburgh, Leeds, Manchester, Margate, Newcastle), is the historical-spend gap present in the daily series too (e.g. Aberdeen's Feb 5–16 PRESALE-solo period missing daily rows)?

### Surface 7 — Reach / Click / LPV display
Engagement metrics surfaced on the Performance Summary + Venue Report.

**Audit questions:**
- Dashboard `meta_reach` SUMs per-day reach across the window — Meta MCP lifetime is dedup'd. Dashboard is 200-488% inflated. Confirm which surfaces actually surface this to clients (internal-only vs client-facing).
- Same question for clicks + LPV.
- If client-facing, propose dedupe path (use Meta lifetime fetch, not daily sum).

### Surface 8 — Channel coverage gaps
The Glasgow O2 (+403), SWG3 (+794), Manchester (+66) external-channel tickets we topped up today.

**Audit questions:**
- Was the live cron supposed to pick up venue-channel sales? Is there an existing integration with O2 Academy / SWG3 / SeeTickets I haven't found?
- If no integration exists, what's the right shape: (a) keep manual topups via SQL + cron at week-end? (b) Build per-channel ingest? (c) Surface a banner saying "venue-channel sales added separately"?
- Confirm whether Brighton, Bristol, Margate also have known external-channel gaps not yet topped up.

## All 8 known bugs — confirm or correct

| Bug | Surface(s) | Description |
|---|---|---|
| A | Topline + Venue Report + Performance Summary + Daily Spend | PRESALE-overlap legacy spend not captured (8 venues, ~£3,800) |
| B | Topline + Venue Report + Performance Summary + Funnel Pacing | Allocator under-share — Brighton -£1,723 + London-Onsale -£1,155 |
| C | All — RESOLVED by PR #530 | Glasgow CAMPAIGN_SPLITS stale (closed) |
| D | All | London-Presale dashboard shows £0 vs truth £878 |
| E | Topline + Venue + Performance + Funnel | Glasgow venue-channel tickets — NOW patched via SQL topups, audit whether cron should ingest |
| F | Topline + Venue + Performance | Manchester external sales (SeeTickets) — NOW patched, same audit question as E |
| G | Performance Summary + Venue Report | Reach/Click/LPV per-day SUM = 200-488% inflated vs Meta lifetime |
| H | Daily Tracker | Daily ticket delta = cumulative-diff, contaminated by reconciliation writes + cron timing. Manchester +43 on Jun 4 = our topup row, not real sales |

## Diagnosis deliverable

Single output: `docs/dashboard-truth-audit-2026-06-04.md`

Structure per surface:
```
# Surface N — <name>
## Data flow (5-line max trace)
## Current value (Edinburgh or specified venue): £X / N tickets
## Truth: £Y / M tickets
## Drift origin: <function name>, <file>:<line>
## Fix shape: <patch | refactor | architectural>
## Estimated PRs: <count + branch names>
```

End with:
```
# Cross-surface findings
Which bugs hit multiple surfaces; which fixes cascade; recommended PR sequence.

# Daily-tracking fix proposal
Specific recommendation for Surface 5 + Bug H — switch source to ticketing_purchase_events, or other.
```

## Anti-drift guardrails

- **DO NOT MODIFY ANY CODE.** Audit-only. Implementation PRs after Matas reads the audit.
- **DO NOT SQL-UPDATE rollups to mask drift.** Bug H makes that worse.
- **DO NOT GUESS line numbers.** Read the file. Grep for the helper. Verify on `main`.
- **DO NOT propose CAMPAIGN_SPLITS-style overrides for surfaces 1-8.** PR #493 is for Glasgow only.
- **VERIFY every premise.** Per `feedback_verify_premises_before_mega_prompts`. PR #491 cost lesson: 3 wrong premises = 1-2h of wasted audit work.
- **DO NOT touch `lib/dashboard/venue-spend-allocator.ts` or `lib/insights/meta.ts`.** Read only.

## Branch / model

- Branch: `cursor/dashboard-truth-audit-2026-06-04` — audit only, no code
- Model: Opus
- Subsequent fix PRs after audit lands: one per surface, Sonnet, `cursor/dashboard-fix-{surface}-{bug}`

## Verification gate

Before audit doc is merged:
- Show specific line numbers for each surface's drift origin (grep proof)
- Confirm each of bugs A-H with concrete evidence (1-line code snippet OR Supabase query result)
- Propose a fix sequence ranked by client-impact × engineering-cost

## Cross-references

- PR #418 (canonical event metrics)
- PR #460 (sumLifetimePaidMediaSpend extraction)
- PR #481 (60-day allocator window cap)
- PR #491 (target_capacity column)
- PR #493 (CAMPAIGN_SPLITS pattern)
- PR #494 (legacy paused-spend backfill — partial)
- PR #495 (effective_status hotfix on #494)
- PR #530 (Glasgow CAMPAIGN_SPLITS refresh + ticket topups — MERGED today)
- Cross-reference xref Excel: `/sessions/serene-tender-keller/mnt/meta-campaign-builder/WC26_funnel_xref_v10_2026-06-04.xlsx`

After audit completes, Matas reads + decides fix-PR sequence. DO NOT pre-empt implementation branches.
