[Use Opus]

# PR B — Stop calling every creative rejection "Development mode". Task #95. One PR, `cursor/creative-error-not-app-mode`, off fresh `main`. Open, don't merge.

`app/api/meta/launch-campaign/route.ts:3757-3767`, Phase 3 creative create catch:

```ts
const isAppModeError =
  rawMessage.toLowerCase().includes("development") ||
  rawMessage.toLowerCase().includes("live mode") ||
  rawMessage.toLowerCase().includes("app is not live") ||
  userMsg.toLowerCase().includes("development") ||
  (isMetaErr && err.code === 200);
```

Code **200** is Meta's generic *"Permissions error"* — it fires when the token lacks `ads_management` on that page, when the IG account isn't authorised on the ad account, when a Business Manager grant is missing, and a dozen other things that have nothing to do with the app's mode. Every one of those currently becomes *"Creative blocked — this ad type requires your Meta app to be in Live/Public mode… switch to Live mode in Meta for Developers"*, `skippedReason: "app_mode_blocked"`, and a red preflight banner telling the operator to change an app setting that is already Live. Same for any message that happens to contain the substring "development".

The app has been in Live mode for months. This branch is now almost always wrong.

## Fix

Move the decision into `lib/meta/launch-error-classify.ts` beside #983's `websiteUrlRequiredMessage` and #985's `archivedCampaignMessage`, as `classifyCreativeCreateError(err) → { kind, message, skippedReason? }`:

- **`app_mode`** only when Meta says so explicitly: message or `userMsg` matching `/app (is )?(in )?development mode|not (in )?live mode|switch (the )?app to live/i`. Code 200 alone is **not** app mode.
- **`permission`** — code 200, or code 10, or subcode 1349125 / 1349131 (page/IG asset not granted): message names the asset the creative uses (`identity.pageId`, `identity.instagramAccountId`) and says the launch token lacks a permission on it, pointing to `/business-managers` where grants are made. `skippedReason: "permission"`.
- **`website_url_required`** (2061015) and **`archived_campaign`** (1487866) — the existing helpers, unchanged, called from here so there is one entry point.
- **`other`** — `rawMessage` with code/subcode appended, as `formatMetaError` does. No advice.

Phase 3 calls the classifier; the `appModeBlockedCount` banner at `:3792` counts `app_mode` only. Add a parallel `permission` banner naming the assets, since that is the case operators actually hit. `components/steps/review-launch.tsx:965-1080` renders the app-mode block — it gets a sibling for `permission` with the asset names and a link to `/business-managers`.

## Guards

No migration. No change to what is sent to Meta. `lib/meta/creative.ts` untouched. Do not touch `lib/tiktok/**`, `lib/optimisation/**`, `lib/google-ads/**`, `lib/google-search/**`. #969's write-set guard unchanged.

## Test plan

Code 200 with message "Permissions error" → `permission`, not `app_mode`, names the page id. Message containing "app is in development mode" → `app_mode`. Message "Invalid parameter … development of …" (the substring in an unrelated sentence) → `other`. 2061015 and 1487866 → the existing messages. A launch log with three permission failures and zero app-mode failures shows the permission banner and not the Development-mode banner — assert on the rendered banner text. Existing `launch-error-classify.test.ts` green.

Full `npm test`, `npm run build`, check-run conclusions in the thread — not in a commit.
