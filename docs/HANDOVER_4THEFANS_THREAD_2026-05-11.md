# Handover → 4thefans Dashboard Thread
**From:** Commercial + Ops thread
**Date:** 2026-05-11 (Sun EOD)
**Subject:** New three-tool execution model — Claude Code added, prompt format updated

## TL;DR

We've changed how execution happens. Cursor is no longer the only execution tool. **Claude Code** (terminal) now handles small/diagnosed tasks at lower cost. Every prompt drafted in Cowork now gets a tool + model tag on line 1.

Reason: £660/mo Cursor burn in April was unsustainable. New target £250/mo.

## What changes for your thread

### Prompt format

Every prompt you draft for Cursor/Claude Code now starts with one of:

- `[Claude Code, Sonnet]` — terminal execution, 1-3 file diagnosed fixes
- `[Cursor, Sonnet]` — editor execution, 4-7 file mechanical refactors
- `[Cursor, Opus]` — editor execution, 8+ file or new architectural primitives

If you draft a prompt without the tag, you're drafting incorrectly.

### Branch convention

Locked in `CLAUDE.md` PR #386:

- `cc/...` branches → Claude Code edits only
- `cursor/...` branches → Cursor edits only
- Never edit the same file in both tools same day

For 4thefans thread work: prefix branches `cc/creator/<feature>` or `cursor/creator/<feature>`.

### The 5-PR queue — re-tagged

| # | PR | Old tag | New tag |
|---|---|---|---|
| 1 | DOM smoke tests | [Sonnet] | **[Claude Code, Sonnet]** |
| 2 | Cron health monitor | [Sonnet] | **[Claude Code, Sonnet]** |
| 3 | Allocator strategy registry | [Opus] | **[Cursor, Opus]** |
| 4 | Admin backfill consolidation | [Sonnet] | **[Cursor, Sonnet]** (5 endpoints = 4-7 files) |
| 5 | Onboarding wizard | [Opus] | **[Cursor, Opus]** |

Two PRs now route to Claude Code (#1, #2). Three stay in Cursor (#3, #4, #5).

### How to recognise Claude Code work in your thread

- Single-file dashboard resolver fix → Claude Code
- One-component DOM test addition → Claude Code
- Parser key addition to existing migration → Claude Code
- Service-role read pattern replication → Claude Code
- Memory/docs/CLAUDE.md updates → Claude Code
- Log query / Vercel MCP / Supabase MCP work → Claude Code

### How to recognise Cursor work in your thread

- Allocator architecture changes touching 5+ files → Cursor Opus
- New resolver pattern affecting trend + history + share → Cursor Sonnet
- Multi-table migration with code wiring → Cursor Sonnet
- Refactoring the snapshot read cascade → Cursor Opus

## What stays the same

- Branch hygiene: PR off fresh `main`, one PR per branch, `gh pr merge --auto --squash --delete-branch`
- GitHub MCP for state verification — Cursor merge-slip pattern still applies
- Memory anchors still required at end of every multi-PR arc
- The four feedback memories (resolver test gap, collapse strategy, snapshot source completeness, defensive JSON parse) still mandatory reading

## Action for this thread

1. Read `/docs/EXECUTION_TOOLING_2026-05-11.md` once before next session.
2. Update any in-flight prompt drafts to include the tag.
3. When the 4tF dashboard ships its next bug fix, default to Claude Code Sonnet unless 4+ files affected.

## Open questions to flag back to Commercial+Ops

- Does the Manchester resolver class of bug ever justify Cursor Opus? (Probably no — it's 1-2 files, but flag if you encounter a case)
- Should we set up a Friday cost-review ritual specific to this thread? (Volume of work suggests yes)

## Full execution standard

`/docs/EXECUTION_TOOLING_2026-05-11.md` is the canonical doc. This handover is a summary.
