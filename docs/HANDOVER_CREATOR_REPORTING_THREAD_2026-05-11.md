# Handover → Campaign Creator + Reporting Thread
**From:** Commercial + Ops thread
**Date:** 2026-05-11 (Sun EOD)
**Subject:** New three-tool execution model — Claude Code added, prompt format updated

## TL;DR

Execution tooling changed. Claude Code (terminal) now handles small/diagnosed tasks alongside Cursor. Every Cowork-drafted prompt now leads with a tool + model tag.

Driver: £660/mo Cursor burn in April → target £250/mo via Claude Code Pro (validating) → Max 5x (£90/mo).

## What changes for your thread

### Prompt format

Every prompt now starts with one of:

- `[Claude Code, Sonnet]` — 1-3 files, diagnosed
- `[Cursor, Sonnet]` — 4-7 files, mechanical
- `[Cursor, Opus]` — 8+ files or new architectural primitives

### Branch convention

Locked in `CLAUDE.md` PR #386:

- `cc/...` branches → Claude Code edits only
- `cursor/...` branches → Cursor edits only

For creator/reporting work: `cc/creator/<feature>` or `cursor/creator/<feature>`.

### Recent work — how it would re-route under the new model

| Recent PR | Re-routed to |
|---|---|
| PR #377 (batched video metadata fetch — 2 files) | Claude Code Sonnet |
| PR #379 (parallel campaign walks — 3 files) | Claude Code Sonnet |
| PR #287/#289 (Manchester resolver fixes) | Claude Code Sonnet |
| PR #297 (revenue formula) | Cursor Sonnet (touched 4 files) |
| Allocator changes for new client shape | Cursor Opus |
| Audience Builder full rewrite (PR #286→#359 26-PR arc) | Cursor mix Sonnet + Opus |

The point: about 60-70% of recent creator/reporting work was Claude Code-shaped. Going forward, that's where it routes.

### How to recognise Claude Code work in your thread

- Single-file resolver/parser bug with known root cause
- Adding a new key to an existing rollup
- Replacing a fetch loop with batched read (PR #377 pattern)
- Service-role RLS pattern application
- Test additions to existing test files
- Log queries via Supabase / Vercel MCP

### How to recognise Cursor work in your thread

- New audience builder subtype (5-10 files touched)
- Major Meta API rate-limit hardening across multiple route handlers
- Snapshot write contract changes
- New schema migration with code wiring across types + queries + UI

## What stays the same

- Vercel MCP for log queries — still preferred, low-cost
- GitHub MCP for PR state verification — Cursor merge-slip pattern still applies
- The audience builder scaling plan (`/docs/META_API_BOTTLENECKS_2026-05-08.md`) is still the source of truth for Meta API capacity work
- Memory namespacing: `project_creator_*` for thread memory

## In-flight items in your thread

- PR-G (cron event parallelism) → re-tag as `[Cursor, Sonnet]` when prompt drafted (4-7 files affected)
- PR-H (per-account meta semaphore) → re-tag as `[Cursor, Sonnet]`
- Junction 2 ticketing connector (~2 day build) → `[Cursor, Opus]` (new primitive)

## Action for this thread

1. Read `/docs/EXECUTION_TOOLING_2026-05-11.md` once before next session.
2. Audit any drafted-but-not-sent prompts and add tags.
3. For the next 5 PRs in your thread, validate the tool/model assignment matches the rubric. Flag back to Commercial+Ops if you find a tag that doesn't fit.

## Open question to flag back

- Audience Builder Stage 2 (PR-H per-account semaphore): is this 4 files or 8 files in reality? Determines Sonnet vs Opus. Worth a quick inspection-only spike before drafting the prompt.

## Full execution standard

`/docs/EXECUTION_TOOLING_2026-05-11.md` is canonical. This handover is a summary.
