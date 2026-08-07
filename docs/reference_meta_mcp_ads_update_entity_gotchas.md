# Meta Ads API gotchas — entity create/update subcodes

Running reference of Meta Graph API subcodes hit while creating or updating
campaigns/ad sets/ads in this repo, and what actually fixed them (verified
against this codebase or a live capture, not guessed from docs alone). Add an
entry here whenever a new subcode gets a recovery ladder or a hard-won fix —
this file did not exist in the repo before task #115/#116 (PR pending,
`cursor/ad-set-launch-recovery-1359207-and-1870196`); if an earlier version
existed elsewhere (e.g. a different tool's session memory), it wasn't
findable from this workspace and this file was started fresh rather than
reconstructed from memory.

## 1359207 — custom audience no longer available

> "This ad set is using one or more custom audiences, which are no longer
> available. You'll need to remove these unavailable audiences to publish
> this ad set." (code 100)

Meta builds ad-set targeting atomically — ONE stale custom audience among
however many rejects the WHOLE ad set. Reproducer: East End Dubs Newcastle
signup launch (2026-08-07), "Similar Pages" ad set (page_group, 10-page seed,
40+ engagement custom audiences) — at least one had aged out on Meta's side.

Unlike 1713140 (below), this message does **not** reliably name the
offending audience id — the fix has to fall back to a batch
`delivery_status`/`operation_status` check
(`fetchCustomAudienceAvailability` in `lib/meta/client.ts`) rather than
parsing an id out of the text.

**Fix:** salvage ladder — drop the id(s) Meta names (if any), else drop
whichever requested ids the batch check flags as unavailable
(`delivery_status.code !== 200`, `operation_status.code` 411/412, or absent
from the batch response entirely), retry ONCE with the reduced
`custom_audiences` list. Fail with an honest explanation only if nothing can
be identified or nothing is left to target.

See `lib/audiences/ca-availability-recovery.ts` (`recoverFromDeletedCa`),
wired into Phase 2 + Phase 2b of `app/api/meta/launch-campaign/route.ts`.

## 1870196 — targeting automation type invalid

> "The targeting automation type passed is invalid. Please pass the correct
> one." (code 100)

Hit by an `advantagePlus: true` ("Wide") ad set under a Registration campaign
(`OUTCOME_LEADS` objective, `LEAD_GENERATION` optimisation goal) on the same
East End Dubs launch. Other `advantagePlus: true` ad sets in the SAME launch
under non-LEADS objectives succeeded with the identical
`targeting.targeting_automation.advantage_audience: 1` field shape — so this
looks objective-specific (Meta rejecting the VALUE for this objective), not
a structurally malformed request. `targeting_automation` is correctly nested
inside `targeting` already (a documented Meta gotcha for a *different*,
similarly-named field — see the `targeting_optimization` note below — that
does not apply to this code path).

No public documentation states the current objective-support matrix for
`targeting_automation.advantage_audience`, and no `validate_only=true` probe
against a live ad account was available to confirm the "correct" replacement
shape mid-session. **Do not guess a field substitution** (e.g. switching to
`targeting_optimization`, or a root-level `advantage_audience`) without
verifying it live first — a second wrong guess is worse than the safe
degrade below.

**Fix shipped:** strip `targeting.targeting_automation` entirely and retry
ONCE with the operator's exact manual age range
(`age_min`/`age_max` from the ad set, not Meta's defaults). Always launches
either way; records a note ("Launched without Advantage+ Audience...") so
the operator knows the automation was dropped rather than silently changed.

See `isInvalidTargetingAutomationError` in `lib/meta/error-classify.ts`,
wired into Phase 2 + Phase 2b of `app/api/meta/launch-campaign/route.ts`.

## Related — not a create/update failure, but easy to confuse with the above

**`targeting_optimization` ("Advantage Detailed Targeting")** — a
*different* Meta feature from Advantage+ Audience
(`targeting_automation.advantage_audience`), despite the similar name.
Controls detailed-targeting *expansion beyond your specified interests*, not
"let Meta pick the whole audience." Field: `targeting.targeting_optimization:
"expansion_all" | "none"`. Per Meta's own docs: *"If you use the
`targeting_optimization` parameter for an unsupported objective, the API
returns an error."* This repo does not set this field anywhere
(`buildMetaTargeting` in `lib/meta/adset.ts` only ever sets
`targeting_automation`) — noted here only because it's the most likely thing
to reach for by mistake when debugging a 1870196-shaped failure.

## Pre-existing subcodes (for context, already handled elsewhere in this repo)

- **1713140** — event-source permission refusal on custom-audience create
  (not ad-set create). See `lib/audiences/event-source-permission.ts` +
  `event-source-recovery.ts` (PR #729).
- **1870247** — deprecated interest on ad-set create. See
  `extractDeprecatedReplacements` / `applyInterestReplacements` in
  `lib/meta/adset.ts`, wired into `launch-campaign/route.ts` Phase 2.
- **1815159 / 1487664** — creative/objective mismatch on ad create. See
  `isObjectiveIncompatibilityError` in `lib/meta/error-classify.ts`.
