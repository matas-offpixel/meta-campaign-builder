# Review loop adoption for Off/Pixel (6 Nov 2026)

Source: "Review loop — from CIRQLIN to Off/Pixel" (Matas, 6 Nov). Ops thread commitments and the setup work.

## What the ops thread (Claude, cowork) changes now
- No merge of a visual PR without a design PASS. #1092 (R3) is green on all four checks and is held for a verdict.
- Migrations are applied only after the PR is on main and its sha256 matches. (On 6 Nov, 205 was applied minutes before #1090 merged. That doesn't happen again.)
- The ops thread stops writing repo files. Prompts and notes go in chat, and docs reach the repo through a Claude Code docs PR (cc/*). Today's untracked files (design-rules.md, pass-2/3 html, prompt logs) go in with the first docs PR below.
- Returns are checked against the PR file list and check runs, not trusted as written.

## Off/Pixel gaps vs CIRQLIN
1. No design records: the Lab frames live as loose files in docs/creative-lab/.
2. Creative Lab, event page, drawers, library, reports and /admin aren't in plan-frames, so the Lab has no CI renders to judge.
3. Baselines can be rewritten in the same PR that changes them.
4. No diff images on a failed frames:check.
5. Widths: the doc says 1176/768 plus 393 only for /admin and /l/. The Creative Lab design rules require 393 for every Lab component (Matas uses it on his phone), so the Lab series is shot at 1280 and 393.

## Setup work, in order
A. Claude Code docs PR: create docs/design-record/ and move the three Lab frames into it as records, plus design-rules.md. Add a README with the loop and the three templates, and a "Review loop" section in CLAUDE.md. No code.
B. Evidence harness for the Creative Lab (Cursor, cursor/*):
   - a fixture-backed route rendering the Lab card states (CL series) with no Supabase or Meta: empty event, lineup only, clips + proposed caption, round proposed, round judged with verdicts, uncleared artist, Instagram candidates;
   - a real fixture clip frame, and TikTok Sans loaded so the caption overlay renders as it would live;
   - shot at 1280 and 393 into a plan-frames-style artifact, with diff images on a failed frames:check;
   - a CI rule that a PR changing docs/frames/*.png needs the design-pass label.
C. From then on, every Lab PR returns the template tail, and every verdict runs through the design thread before the ops thread merges.

## Interim for #1092 (R3)
No CI renders exist for the Lab yet. The design thread judges the Vercel preview of head 66ae04dc in Matas's Chrome, at 1280 and as narrow as the window goes, against pass 3 and the design rules, using the verdict format.
