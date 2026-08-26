# Session log — plan Meta-first derivation

## PR

- **Number:** 854
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/854
- **Branch:** `cursor/plan-meta-first-derivation`

## Summary

Direction correction from the roadmap owner, landed as **v2.2** of
`docs/MULTICHANNEL_ENGINE_ROADMAP_V2_2026-08-21.md`: the plan is not a neutral form with
three thin adapters. Meta is the primary authoring surface — the full existing Meta wizard,
with artist pages, similar-page groups, custom audiences and lookalikes — and TikTok +
Google now take stock FROM the Meta campaign inputs. Plan-level shared inputs shrink to
five: event, destination URL, dates, per-platform budget split, name.

New `lib/plan/derive/` extracts the targeting vocabulary the Meta draft already expresses
and feeds it to each platform through machinery those platforms already have: the TikTok
wizard's own interest-keyword recommend call, and the Google Search plan's keyword tree.
Every derived term carries provenance naming its Meta source, so re-derive can refresh
after Meta edits without touching anything the operator changed in a platform wizard.

## Scope / files

- `lib/plan/derive/vocabulary.ts` — vocabulary extraction from the Meta draft + event row
- `lib/plan/derive/tiktok.ts` — seed terms, suggestion folding, provenance-aware merge
- `lib/plan/derive/google.ts` — seed keywords, noise negatives, merge, plan-tree adaptor
- `lib/plan/derive/server.ts` — loads the draft/event, calls the TikTok recommend endpoint
- `lib/plan/blockers.ts` — wizard-fixable vs plan-fixable blocker split
- `lib/plan/linked-plan.ts` — reverse lookup, Meta draft → owning plan
- `components/plan/plan-workspace.tsx` — Meta-first flow, split blockers, re-derive action
- `components/plan/plan-link-banner.tsx` + `app/campaign/[id]/page.tsx` — "Part of plan"
- `app/api/plan/[id]/derive/route.ts` — re-derive endpoint
- `app/api/plan/[id]/prepare-draft/route.ts` — auto-derive on prepare; Google now preparable
- `lib/types/tiktok-draft.ts` — optional `derivedFrom` on `TikTokTargetingItem`
- `docs/MULTICHANNEL_ENGINE_ROADMAP_V2_2026-08-21.md` — v2.2 amendment + Phase D rewrite

## Validation

- [x] `npx tsc --noEmit` — no new errors in touched files (pre-existing failures in
      unrelated jest-style test files remain)
- [x] `npm run build` — compiled successfully
- [x] `npm test` — 4503 tests, 1117 suites; 2 pre-existing #852 guards updated because
      this PR deliberately supersedes them (Google href, wizard button label)
- [x] Falsified against parent sha `3c18abe`: the whole derive suite fails (modules absent)
      and all four UI guard invariants fail individually

## Notes

**No schema change.** Provenance lives in columns that already exist: the TikTok draft's
`state` jsonb (new optional `derivedFrom` on targeting items) and
`google_search_keywords.notes` (a `plan-derived:` sentinel). No migration file was needed.

**Hashtags are derived but withheld.** `collectTikTokLaunchPreflight` emits
`hashtag-unverified` for ANY draft carrying hashtags, because TikTok hashtag ids are not
verified to share a namespace with `interest_keyword_ids`. Writing derived hashtags into
the draft would make every derived TikTok draft unlaunchable, so derivation returns them
with a named reason instead of silently blocking launch. Revisit if the namespace question
is ever settled.

**Google seed keywords are the vocabulary verbatim.** No "tickets"/"tour" suffixes are
appended — that would be a search term nobody in the plan expressed, and not inventing
keywords is the standing rule for the Google adapter. The operator adds intent modifiers in
the Search wizard where volume and CPC estimates are visible.

**Custom audiences and lookalikes are never derived.** They are Meta-only by nature and
their absence from TikTok/Google blocks nothing — pinned by test.

**Boundary note.** `app/campaign/[id]/page.tsx` is listed READ ONLY in
`.cursor/rules/dashboard-boundaries.mdc`. It was edited because the roadmap owner explicitly
asked for the "Part of plan &lt;name&gt;" entry point in the Meta wizard. The change is
additive and minimal — a banner component rendered above `WizardShell`;
`components/wizard/**` itself is untouched, which a test pins.

**Follow-up named, not built:** create a plan FROM an existing Meta campaign (entry from
the library rather than `/plan/new`).
