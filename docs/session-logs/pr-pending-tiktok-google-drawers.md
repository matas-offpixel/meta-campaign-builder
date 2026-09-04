# Session log — TikTok / Google drawers

## PR

- **Number:** pending
- **URL:**
- **Branch:** `cursor/tiktok-google-drawers`

## Summary

PR 5 of 7 of the campaign creator redesign. The TikTok and Google Search
wizards become the same drawer shell PR 4 gave Meta. Canvas rows and
blockers open `?drawer=tt|g&tab=…` in place; `/tiktok-campaign/[id]` and
`/google-search/[id]` mount the same component `variant="page"`. No step
internals were rewritten — each existing step mounts behind
`surface="drawer"` and routes chrome through the five primitives from #879.
Plan-linked drafts lose Launch / Push (the canvas launches paused via
fan-out). Standalone pages keep them. `lib/tiktok/write/**` and
`lib/google-search/**` are untouched.

## Scope / files

**New**

- `components/plan/tiktok-drawer.tsx` — video · refine (+ assign when
  routed videos > 1); template loader from `lib/db/tiktok-templates.ts`;
  ReviewLaunch only on `variant="page"` with no plan.
- `components/plan/tiktok-drawer-details.tsx` — advertiser · identity ·
  pixel · event · objective · goal · bid · budget · schedule · frequency
  · pacing, all DONE ⌁. Manual identity fields stay behind a `BC_AUTH_TT`
  disclosure inside the account step.
- `components/plan/google-drawer.tsx` — keywords · copy; header loader
  present and disabled (`no templates`); Push only on standalone page.
- `components/plan/google-drawer-details.tsx` — account · customer ·
  structure · bidding · geo · final URL · daily budget.
- `lib/wizard/use-tiktok-draft.ts` — serial PATCH queue + GET hydrate.
- `lib/wizard/use-google-search-tree.ts` — 1500 ms PUT debounce + GET hydrate.

**Changed**

- `lib/plan/drawer.ts` — TikTok/Google tabs, `tiktokNeedsVideoBlockers`,
  `googleKeywordBlockers`, detail-row helpers, drawer copy.
- `components/plan/plan-workspace.tsx` — `openDrawerOrWizard` is adapter-
  generic; `openRefs` per adapter; both drawers mount beside Meta.
- `app/api/plan/[id]/mirror/route.ts` — TikTok "needs 1" and Google
  keyword blockers ride the mirror.
- `app/api/tiktok/drafts/[id]/route.ts` — GET (PATCH unchanged).
- `app/api/google-search/[id]/route.ts` — GET (PUT unchanged).
- `lib/plan/linked-plan.ts` — reverse lookup for TikTok and Google drafts.
- Both wizard shells — stepper/footer gone; they render the drawer
  `variant="page"`.
- Both standalone pages — pass `linkedPlan` so plan-linked drafts hide
  Launch / Push.
- Every TikTok and Google step file — `surface` + chrome routing.
- `scripts/codemod-step-chrome.mjs` — those files added to `FILES`.
- `lib/plan/__tests__/drawer.test.ts` — DRAWER_MOUNTED extended; URL /
  anchor / needs-1 / keyword-index / standalone / write-path guard.

## Validation

- [x] `npx tsc --noEmit` — clean for every touched source file.
- [ ] `npm run build` — not run this session.
- [x] `node --test lib/plan/__tests__/drawer.test.ts lib/plan/__tests__/derive.test.ts` — 99 + derive provenance green.
- [ ] Browser — no authenticated plan/TikTok/Google session in this environment.

## Notes

### Per-file `surface="drawer"` effect

| File | Effect |
|---|---|
| `tiktok-wizard/steps/creatives.tsx` | Header, Spark-Ad mode, base name / variations hidden. Landing URL → destination badge. Routed items show ⌁. Empty → StatusLine. Upload / paste / ad text / CTA / display name stay. |
| `tiktok-wizard/steps/audiences.tsx` | Header hidden. Seed box hidden (`<Chrome>`). Derived chips show ⌁. Age / add / remove stay. |
| `tiktok-wizard/steps/assign-creatives.tsx` | Header hidden. Matrix stays. Tab only mounts when routed videos > 1. |
| `tiktok-wizard/steps/account-setup.tsx` | Header hidden. Four Manual identity fields behind `BC_AUTH_TT` disclosure. |
| `tiktok-wizard/steps/campaign-setup.tsx` | Header hidden. Mounted only in details. |
| `tiktok-wizard/steps/optimisation-strategy.tsx` | Header hidden. Mounted only in details. |
| `tiktok-wizard/steps/budget-schedule.tsx` | Header hidden. Mounted only in details. |
| `tiktok-wizard/steps/review-launch.tsx` | Chrome stripped. Mounted only on standalone page (`!planId`). Writes gate untouched. |
| `google-search-wizard/steps/ad-groups-keywords.tsx` | Intent + Est CPC columns hidden; hover/InfoTip. Derived keywords ⌁. Empty → StatusLine. |
| `google-search-wizard/steps/negatives.tsx` | Reason column hidden. Campaign-overrides card hidden; campaign-level add row stays. Preset rows ⌁. |
| `google-search-wizard/steps/ad-copy.tsx` | Final URL → badge. RSA / sitelinks stay. Empty → StatusLine. |
| `google-search-wizard/steps/plan-setup.tsx` | Chrome stripped. Details only. |
| `google-search-wizard/steps/campaigns.tsx` | Chrome stripped. Details only. |
| `google-search-wizard/steps/targeting-budget.tsx` | Chrome stripped. Details only. |
| `google-search-wizard/steps/push.tsx` | Chrome stripped. Mounted only on standalone page. Push logic untouched. |

### PR 7 deletion manifest additions

- TikTok wizard stepper + `TikTokWizardFooter` (unused from the page path).
- Google wizard stepper + Back/Continue/Push footer (Push lives on the drawer for standalone).
- TikTok seed box (`SearchInput` "Seed keyword…").
- Google Intent + Est CPC columns; negatives "reason" field; campaign-overrides card.
- Canvas `wizardHrefForDraft` navigation for TikTok/Google (already unused from `openDrawerOrWizard`).
- Plan-linked ReviewLaunch / Push (already gated).
- `scripts/codemod-step-chrome.mjs` itself (after every `<p>` call site is gone).

### Click count (TikTok drawer path vs §8)

§8 asked for 3: open · upload · Done.

Honest count on the happy path (one routed placeholder, operator uploads a video): **3**. Refine is optional. Assign does not appear when routed videos ≤ 1. If derivation left no interests, adding one is a fourth click — that is the exception, not the path §8 counted.

### UNVERIFIED

- TikTok upload / video lookup against a live advertiser (needs TikTok credentials).
- `OFFPIXEL_TIKTOK_WRITES_ENABLED` Launch on the standalone page (gate read, not exercised).
- Google Ads push on the standalone page (push module untouched; not exercised).
- Canvas Google details account/customer names — `wizardContext` is not passed from the canvas, so those rows show ids. PlanSetup disclosure is hidden on the canvas for the same reason.
- Frequency cap / pacing provenance marked `industry seed` from the draft defaults, not from a TikTok capability check.
