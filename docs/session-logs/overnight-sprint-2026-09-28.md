[Use Opus]

# Overnight sprint 2026-09-28 — four PRs, four branches, all off fresh `main`. Each opens as a draft, none merges. Report each in its own thread with check-run conclusions.

(Full text was sent in chat; this file records the four briefs.)

## PR 1 — `cursor/persist-meta-creative-ids` (task #130)
`publishedDraft` at `launch-campaign/route.ts:~4596` spreads `draft`, not `updatedCreatives`, so Phase 3's `metaCreativeId` stamps are discarded. Persist `updatedCreatives`; add optional `metaAdIds?: string[]` per creative from Phase 4 (and the MC loop). No Meta changes.

## PR 2 — `cursor/asset-queue-retry-requeue` (tasks #24, #26)
Route accepts only skip/launched/confirm. Add `retry` (error → pending/matched, re-run prepare) and `requeue` (skipped → pending, overrides cleared). Panel buttons on the right statuses only.

## PR 3 — `cursor/audience-builder-reuse-existing`
Before `createMetaCustomAudience` creates, compare the rule structurally against the account's existing audiences (`fields=…,rule`); on match reuse the id and record it. Covers page/video/pixel/lookalike/in-creator; not customer lists. Zero new writes.

## PR 4 — `cursor/upload-size-guards` (task #79)
Client-side refuse >30 MB images and >200 MB videos before upload; server-side `sharp` compression for oversize images only if sharp is already a dependency and the route runtime allows; a notice on >30 MB videos.
