# Session log — Remotion docs supersede AWS path

## PR

- **Number:** 532
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/532
- **Branch:** `cursor/ops/remotion-docs-supersede-aws-path`

## Summary

Housekeeping follow-up to PR #531: renamed AWS-Lambda Remotion docs with `*_SUPERSEDED_*` discipline, added supersede/shipped banners, and committed the canonical Vercel Cursor prompt for the first time.

## Scope / files

- `docs/REMOTION_AWS_SETUP_SUPERSEDED_2026-06-04.md` — git mv + banner
- `docs/cursor-prompts/REMOTION_WEEK1_POC_AWS_SUPERSEDED_2026-06-04.md` — git mv + banner
- `docs/cursor-prompts/REMOTION_WEEK1_POC_VERCEL_2026-06-04.md` — canonical banner (first commit)
- `docs/REMOTION_SCOPE_2026-05-20.md` — section-2 supersede note

## Validation

- [x] `git log --follow` on superseded AWS setup doc
- [x] `npm run build` — exit 0
- [x] Banners above `#` titles on all four files
- [ ] `npm run lint` — repo-wide pre-existing errors; no code touched

## Notes

- AWS setup + AWS week-1 prompt were untracked on main before this PR; first committed under superseded filenames after staging + `git mv`.
