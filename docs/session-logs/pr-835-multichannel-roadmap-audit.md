# Session log — multichannel engine roadmap audit

## PR

- **Number:** 835
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/835
- **Branch:** `cursor/multichannel-roadmap-audit`

## Summary

Adversarial audit of `docs/MULTICHANNEL_ENGINE_ROADMAP_2026-08-21.md`, commissioned with an
explicit mandate to disagree where evidence supports it. Deliverable is one document,
`docs/MULTICHANNEL_ENGINE_ROADMAP_AUDIT_2026-08-21.md`. No code changes.

The audit verified the roadmap's eight load-bearing factual claims against the codebase and
against production data: 1 confirmed, 4 wrong, 3 partial. It raises eight substantive
disagreements and proposes a re-sequenced counter-roadmap (Phases A–F) that fixes measurable
data defects first, ships the billable reporting tier with no new schema, gates the multichannel
machinery behind an adoption checkpoint, and cuts the API/MCP surface and forecasting phase.

## Scope / files

- `docs/MULTICHANNEL_ENGINE_ROADMAP_AUDIT_2026-08-21.md` — new, the sole deliverable
- `docs/session-logs/pr-835-multichannel-roadmap-audit.md` — this log

No source files touched.

## Validation

- [n/a] `npx tsc --noEmit` — documentation only, no TypeScript changed
- [n/a] `npm run build` — documentation only
- [n/a] `npm test` — documentation only

## Notes

**Production evidence.** Three of the roadmap's claims are about whether data exists, which schema
reading cannot answer. Read-only SQL was run against the `meta-campaign-builder` Supabase project
(`zbtldbfjbhfvpksmdvnt`) on 2026-08-25. Findings are labelled `[measured]` in the document. The
three that changed the conclusion:

1. `event_daily_rollups.tickets_sold` has been **zero for July and August 2026** across all events,
   while `ticket_sales_snapshots` ingested 19,058 rows over the same window. A silent broken leg in
   the exact table the roadmap calls "the trustworthy join".
2. `event_signups` contains **one row**. `page_events` and `client_landing_pages` contain one each.
   The first-party attribution spine that Phases 2 and 5 depend on is empty.
3. Spend is **98.8% Meta** (July 2026: Meta £378,503 / TikTok £4,596 / Google £52), and only
   **six events in the product's history** have ever run two platforms on the same day. The
   cross-platform allocation engine has almost no subject population.

**Follow-up worth opening regardless of the roadmap decision:**

- The rollup tickets bug (recommended first PR in the audit) is a live client-facing defect
  independent of any roadmap: the dashboard currently reports zero tickets for the quarter.
- `app/api/meta/launch-campaign/route.ts` has no rollback, cleanup or idempotency (zero grep
  matches) and launches ACTIVE, i.e. spending immediately. TikTok and Google both launch paused and
  both roll back. This is the highest-spend launcher with the weakest safety net.

**Corrections made during the audit.** An exploration pass reported a divergence between Meta's
cluster constants (`"Fashion & Streetlife"`) and TikTok's (`"Fashion & Streetwear"`). Direct
verification showed the strings are identical everywhere; the finding was dropped rather than
published.

**Process note.** Both audited documents (`MULTICHANNEL_ENGINE_ROADMAP_2026-08-21.md`,
`NORTHBEAM_PARITY_PATH_2026-08-21.md`) are untracked in git as of `85df018`. Roadmap step 0.3
assigns committing them to Matas. This PR does not commit them, per the one-document scope, so the
audit currently cites a subject the repo does not contain.
