# Cursor prompt [Cursor, Opus] — Google Search Wizard Phase 2: wizard UI shell

Copy this entire block into Cursor as a single message. Opus — multi-file UI architecture mirroring the Meta wizard.

PREREQUISITE: Phase 1 (`creator/google-search-wizard-data-model`) must be merged + migration 096 applied first. This phase builds on its tables + types + CRUD.

---

## GOAL

Build the Google Search Campaign Creator wizard UI at route `/google-search/[id]`, mirroring the Meta wizard's multi-step shell. The wizard is primarily a REVIEW + EDIT surface over an imported plan (Phase 1's xlsx import), with manual-add capability. It ends with a "Push to Google Ads" step that Phase 3 will wire to the real mutate adapter (in Phase 2, the push button can be a stub that calls a not-yet-implemented route — wire the real push in Phase 3).

Read first:
- `docs/GOOGLE_ADS_SEARCH_WIZARD_SCOPE_2026-04-30.md`
- `components/wizard/wizard-shell.tsx` — the Meta wizard's 8-step shell. MIRROR its architecture: step navigation, autosave cadence, draft-state flow, step-validity gating.
- `lib/types.ts` `CampaignDraft` — the Meta wizard root-state pattern
- `lib/autosave.ts` — `saveDraftToStorage` / `loadDraftFromStorage` / `migrateDraft`. Mirror autosave behavior.
- `lib/google-search/types.ts` (from Phase 1) — `GoogleSearchPlanTree` and child types
- `lib/db/google-search-plans.ts` (from Phase 1) — `loadGoogleSearchPlanTree`, `saveGoogleSearchPlanTree`
- The Meta wizard step components in `components/wizard/steps/` — for visual + interaction consistency

IMPORTANT: Phase 1 may have made reasonable schema deviations from the prompt. Before building, read the ACTUAL `lib/google-search/types.ts` and `lib/db/google-search-plans.ts` as they exist on main, and build the UI against the real shapes — not against what this prompt assumes. If a field named differently, use the real name.

## CONTEXT

```bash
git checkout main && git pull --ff-only
git checkout -b creator/google-search-wizard-ui
```

## ROUTE

`app/google-search/[id]/page.tsx` — loads the plan tree by id, renders the wizard shell. Mirror how `app/campaign/[id]/page.tsx` loads a Meta draft and passes it to `wizard-shell.tsx`.

Library/landing: add a Google Search section to wherever campaigns are listed (or a new `/google-search` index showing plans). Minimal — a list of plans with status badges + "New plan" + "Import from xlsx" buttons. The import button hits the Phase 1 `/api/google-search/import` route.

## WIZARD STEPS

Build `components/google-search-wizard/wizard-shell.tsx` + step components. Steps:

0. **Plan Setup** — event link (dropdown of events), Google Ads account (dropdown from `google_ads_accounts`), plan name, total budget, date range, bidding strategy (Maximise Clicks default; Manual CPC option). Auto-suggest plan name from event.
1. **Campaigns** — table/list of campaigns. Each row: name, priority, monthly budget, notes. Add/remove/reorder. This is where imported campaigns show up for review.
2. **Ad Groups & Keywords** — per campaign, expandable to show ad groups, each with its keyword list (keyword text, match type dropdown EXACT/PHRASE/BROAD, intent tag with colour-coding green=transactional/navy=brand/amber=discovery, est CPC range). Add/edit/remove keywords. This is the densest screen — make it scannable.
3. **Negative Keywords** — shared (all-campaigns) list + per-campaign overrides. Match type + reason.
4. **Ad Copy (RSA)** — per ad group, the RSA editor: headlines (max 15, ≤30 chars each with live char counter + red when over), descriptions (max 4, ≤90 chars each), final URL, display paths. Live validation. Reuse any char-validation primitive the Meta wizard creative step has.
5. **Targeting & Budget** — geo targets with bid modifiers (+20% London etc), device/schedule bid adjustments, budget allocation per campaign (sum-check against total). Maximise Clicks reminder (no conversion tracking note).
6. **Review** — full plan summary. Validation panel: char-limit violations, keyword/negative conflicts (a keyword that's also a negative), campaigns with no keywords, RSAs with <3 headlines (Google minimum), budget mismatches. Block push if hard errors; warn on soft.
7. **Push to Google Ads** — summary of what will be created (N campaigns, M ad groups, K keywords, all PAUSED). Push button. In Phase 2 this calls `POST /api/google-search/[id]/push` which can return `{ ok: false, reason: 'not_implemented' }` as a stub — Phase 3 implements it. Show the response. After a real push (Phase 3), show created-resource links + a "view in Google Ads" deep link.

## STATE MANAGEMENT

Mirror the Meta wizard exactly:
- Load `GoogleSearchPlanTree` from DB on mount
- Local state for the working tree
- Autosave to Supabase via `saveGoogleSearchPlanTree` on change (debounced, mirror Meta's cadence)
- Optionally localStorage backup like Meta's `saveDraftToStorage` (reuse the pattern if low-cost)
- Step-validity gating: can't reach Review with hard errors

DO NOT reinvent state management — copy the Meta wizard's approach. If the Meta wizard uses a reducer, use a reducer. If context, use context.

## VALIDATION RULES (Review step)

Hard errors (block push):
- Any campaign with 0 keywords
- Any ad group with 0 RSAs OR an RSA with <3 headlines or <2 descriptions (Google minimums)
- Headline >30 chars, description >90 chars
- No Google Ads account selected
- Total campaign budgets exceed plan total

Soft warnings (allow push, flag):
- Keyword that also appears as a negative (cannibalization)
- Campaign with no negatives at all
- Budget significantly under-allocated vs total

## VALIDATION

```bash
npx tsc --noEmit
npx eslint app/google-search/ components/google-search-wizard/
npm run build
```

Component tests where practical (char validation, conflict detection). DOM-level test for at least the Review step's validation panel.

## NON-NEGOTIABLES

- Branch: exactly `creator/google-search-wizard-ui`
- New route `/google-search/[id]` — do NOT touch `/campaign/[id]` (Meta-only)
- Read the ACTUAL Phase 1 types/CRUD from main, build against real shapes
- Reuse Meta wizard patterns (shell, autosave, step gating) — don't invent new ones
- Do NOT implement the real push adapter — that's Phase 3. Stub the push route.
- Do NOT touch lib/types.ts root (shared-file rule)
- Do NOT add migrations
- Tailwind core utilities only (no arbitrary values if the repo convention avoids them — match existing components)

## SESSION LOG + PR

`docs/session-logs/pr-NNN-creator-google-search-wizard-ui.md`. PR title: `feat(creator): Google Search wizard UI shell (Phase 2)`.

## IF YOU HIT A WALL

If the Meta wizard's state management is too entangled to cleanly mirror, build a simpler self-contained version for the search wizard (the search plan tree is simpler than CampaignDraft). Document the divergence. Don't spend hours forcing a 1:1 mirror if a clean simpler version ships faster.
