# Cursor prompt — Remotion docs housekeeping (post-#531)

**Tag:** `[Cursor, Sonnet]`
**Branch:** `cursor/ops/remotion-docs-supersede-aws-path`
**Prereq:** PR #531 merged on main (commit b365910)
**Scope target:** 4 file ops, single PR, no code changes — pure docs hygiene

## Why this PR exists

PR #531 shipped Remotion in-process on Vercel (no AWS Lambda). The earlier AWS-path scope + setup docs are now stale. Leaving them in place will mislead future Cursor / Cowork sessions into reasoning against the wrong architecture. Mark them as superseded; promote the Vercel variant as canonical.

DO NOT delete the AWS docs — git history is fine but the file rename keeps the history walkable without a `git log` dig. Renaming with `*_SUPERSEDED_*` is the established discipline (see existing precedent in repo).

Copy the block below into Cursor.

---

```
GOAL
Mark the obsolete AWS-Lambda variant Remotion docs as superseded and add a one-line banner to the canonical Vercel doc pointing at the shipped PR. No code changes.

FILES TO RENAME (use `git mv` so history follows)

1. docs/REMOTION_AWS_SETUP_2026-06-04.md
   → docs/REMOTION_AWS_SETUP_SUPERSEDED_2026-06-04.md

2. docs/cursor-prompts/REMOTION_WEEK1_POC_2026-06-04.md
   → docs/cursor-prompts/REMOTION_WEEK1_POC_AWS_SUPERSEDED_2026-06-04.md

FILES TO EDIT — add a banner at the very top, before any existing content

3. docs/REMOTION_AWS_SETUP_SUPERSEDED_2026-06-04.md
   Prepend (above the existing # title):

   > ⚠️ **SUPERSEDED 2026-06-04.** Output spec changed to ≤30s stills/video. Vercel function limit covers render time with 10× headroom. AWS Lambda + S3 + IAM provisioning is no longer required.
   >
   > **Canonical path:** in-process render on Vercel via `@remotion/renderer` — shipped in PR #531 (commit b365910). Live source-of-truth: `docs/cursor-prompts/REMOTION_WEEK1_POC_VERCEL_2026-06-04.md`.
   >
   > Kept for history. Do not action.

4. docs/cursor-prompts/REMOTION_WEEK1_POC_AWS_SUPERSEDED_2026-06-04.md
   Prepend (above the existing # title):

   > ⚠️ **SUPERSEDED 2026-06-04.** AWS Lambda render path replaced by in-process Vercel render. See `docs/cursor-prompts/REMOTION_WEEK1_POC_VERCEL_2026-06-04.md` for the canonical Cursor prompt that produced PR #531.
   >
   > Kept for history. Do not action.

FILES TO EDIT — add a banner at the very top, before any existing content

5. docs/cursor-prompts/REMOTION_WEEK1_POC_VERCEL_2026-06-04.md
   Prepend (above the existing # title):

   > ✅ **Shipped 2026-06-04 via PR #531** (commit b365910). This is the Cursor prompt that produced the live Remotion provider.
   >
   > Refer to this file (not the AWS variant) for the architecture context behind Off/Pixel's current Remotion integration.

6. docs/REMOTION_SCOPE_2026-05-20.md
   Prepend (above the existing # title):

   > ℹ️ **2026-06-04 update.** Section 2 ("Build / buy on Remotion") is partially superseded — the Lambda recommendation flipped to in-process Vercel render when the output spec narrowed to ≤30s. AWS Lambda remains the right call IF we later add long-form video output (>1 min). Currently we do not.
   >
   > Week-1 POC shipped via PR #531 using the Vercel-only path.

CONSTRAINTS
- Use `git mv` for renames. Do NOT `rm` + new file — history must be preserved.
- DO NOT touch any code files. Pure docs PR.
- DO NOT delete the AWS docs entirely. The history value of the alternate-architecture decision exceeds the cost of two extra files in docs/.
- DO NOT change any in-code documentation references — none should exist, but if any do, surface them rather than rewriting.

VALIDATION GATE
- `git log --follow docs/REMOTION_AWS_SETUP_SUPERSEDED_2026-06-04.md` shows the original file's history through the rename.
- `npm run build` exit 0 (paranoid check that no MD file is imported by code somewhere — extremely unlikely but cheap).
- `npm run lint` clean.
- All 4 renamed/edited files have the banner block at the top, above the existing title.

PR DESCRIPTION
Tiny housekeeping follow-up to #531. Marks the AWS-Lambda-path Remotion docs as superseded, promotes the Vercel variant as canonical, preserves history via git mv. No code changes.

Files touched:
- Renamed docs/REMOTION_AWS_SETUP_*.md (banner added)
- Renamed docs/cursor-prompts/REMOTION_WEEK1_POC_*.md AWS variant (banner added)
- Banner added to docs/cursor-prompts/REMOTION_WEEK1_POC_VERCEL_*.md (canonical pointer)
- Banner added to docs/REMOTION_SCOPE_2026-05-20.md (section-2 supersede note)
```

---

## After Cursor opens this PR

1. Vercel preview will be a no-op build (no code changes) — should be green in ~30s.
2. Merge with plain merge (no `--auto`, no branch protection, per `feedback_gh_pr_merge_auto_pitfall`).
3. Wait ~90s between this merge and any next merge per the four-thread deploy-race rule.
4. Mark task #23 complete on merge.

## What's left after this lands

Tasks #24 (userId arg refactor — week 2 work) and #25 (cold-instance Chrome smoke test — pre-Production flag flip) are independent of this housekeeping and don't depend on it. Order them by your priority, not by the doc state.
