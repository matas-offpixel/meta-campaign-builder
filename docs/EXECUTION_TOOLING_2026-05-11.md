# Execution Tooling — Three-Tool Model (2026-05-11)

This is the active execution standard across all Off/Pixel Cowork threads as of 2026-05-11. Replaces the previous Cowork → Cursor split.

## The three execution surfaces

1. **Cowork** — strategy, research, prompt drafting, memory curation, MCP-driven ops (Supabase migrations, Vercel deploys, GitHub MCP merges). Never executes git or code edits.
2. **Claude Code** — terminal-based execution agent. Owns `cc/...` branches. Runs on Claude Pro (validating) → Max 5x (£90/mo) once Pro limits hit.
3. **Cursor** — editor-based execution agent. Owns `cursor/...` branches. Stays on Cursor Ultra (£160/mo) for architectural work.

## Cost context

- April 2026: Cursor £160 + £500 overage = £660/mo
- Target: Cursor £160 + Claude Max £90 = £250/mo
- Driver: ~50-60% of historical Cursor volume migrates to Claude Code

## Decision rubric (use this for every prompt)

| Question | If yes → | If no → |
|---|---|---|
| Is the root cause diagnosed and bounded? | Continue | Cursor Opus |
| Does the change touch 1-3 files? | Claude Code Sonnet | Continue |
| Does it touch 4-7 files? | Cursor Sonnet | Continue |
| Does it touch 8+ files or introduce a new primitive? | Cursor Opus | — |

Default when uncertain: **Claude Code Sonnet.** Upgrading mid-task is one `/model` command in Claude Code or a new prompt in Cursor.

## Prompt tag convention

Every prompt drafted in Cowork **must lead with** one of these tags on line 1:

- `[Claude Code, Sonnet]` — terminal execution, small/diagnosed
- `[Cursor, Sonnet]` — editor execution, multi-file mechanical
- `[Cursor, Opus]` — editor execution, architectural

If a prompt lacks the tag, it's drafted incorrectly. Pause and re-tag before sending.

## Branch convention (mandatory)

Locked in `CLAUDE.md` as of PR #386:

- `cc/<thread>/<feature>` — Claude Code-owned. Only Claude Code edits.
- `cursor/<thread>/<feature>` — Cursor-owned. Only Cursor edits.
- One tool per branch end-to-end. No mid-PR handoffs.
- Never edit the same file in both tools same day.
- Always pull `main` before opening a new branch.

## Per-thread guidance

### Creator (campaigns + reporting)
- Reporting fixes, parser additions, single-file resolver bugs → Claude Code Sonnet
- Audience builder rate-limit / parallelisation work → Cursor Sonnet (already historical pattern)
- Schema migrations + new architectural primitives → Cursor Opus

### Creative (motion tagger + creative review)
- AI auto-tagger improvements, score calculation tweaks → Claude Code Sonnet
- Tag UI components, thumbnail proxy → Cursor Sonnet
- New tagging strategies / score model overhauls → Cursor Opus

### D2C / Ops
- D2C send automation hooks, template additions → Claude Code Sonnet
- Multi-step automation flows → Cursor Sonnet
- New d2c primitive surfaces → Cursor Opus

### Commercial+Ops (this thread)
- No execution. Drafts prompts. Routes work to other threads.
- Always recommends tool + model when drafting prompts.
- Source of truth on cost burn — flag if Claude Code Pro hits limits or Cursor overages spike.

## Approval gates inside Claude Code

When Claude Code prompts for command approval:

- **Option 2 ("don't ask again")** — safe, frequent: `git checkout`, `git add`, `git commit`, `git status`, `git diff`, `ls`, `cat`, `npm test`, `npm run lint`
- **Option 1 ("yes" once)** — destructive or publish-step: `git push`, `gh pr create`, `gh pr merge`, `rm`, `npm install`
- **Option 3 ("no")** — anything unfamiliar or wrong

Never approve `gh pr *` blanket — too wide (includes `gh pr close`, `gh pr edit`).

## When this changes

- If Claude Code Pro routinely hits limits during a deep-work block → upgrade to Max 5x £90/mo
- If Max 5x routinely hits limits → upgrade to 20x £180/mo
- If Cursor overage starts again → audit recent prompts, find Cursor-shaped tasks that should've been Claude Code
- Friday weekly review: pull task list, validate tool/model split worked, adjust rubric if needed
