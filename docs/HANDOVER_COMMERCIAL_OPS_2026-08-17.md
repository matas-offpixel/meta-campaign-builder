# Commercial + Ops Handover — Meta Platform Developments

**Date:** 17 August 2026
**Scope:** New Meta developer app, campaign-builder reliability fixes, and what changes for day-to-day ops this week.

---

## Headline

We built and shipped a **new Meta developer app ("Off Pixel Ads Manager")** in a single day to replace the old app's permanently-stuck approval state, and proved it end-to-end with a fully clean 10-ad campaign launch. A **Standard Access application to Meta is ~90% submitted** — once granted, it removes the rate-limit throttling and API restrictions that have caused most of our Meta reliability pain this year.

---

## Why this matters commercially

1. **Rate limits.** The old app has been running at Meta's lowest access tier. That tier caused the recurring "rate limit — try again in 30 min" launch delays, throttled reporting syncs, and the thumbnail-repair dead-ends. Standard Access lifts us to higher rate limits and unlimited ad-account management.
2. **Root cause finally proven.** The long-standing `/adimages` block (the thing stopping us repairing broken motion-ad thumbnails) was proven today to be a **tier restriction, not an app problem** — a brand-new, cleanly-configured app fails identically. Chasing app-level fixes is over; the only path is the access-tier upgrade, which is now in motion.
3. **Two production systems, zero client disruption.** Old app + current tool ("v1") keeps running all live client campaigns untouched. The new app runs on a parallel deployment ("v2") sharing the same database and campaign library. Nothing changes for clients during the transition.

## What shipped today

- **New Meta app** created under the Off / Pixel Business Manager: business verification inherited (green immediately, vs the weeks-long limbo on the old app), all settings/URLs/permissions configured, and **published Live**.
- **Parallel v2 deployment** of the campaign builder wired to the new app. Same tool, same data; only the Meta credentials differ.
- **App Review submission for Standard Access** prepared: all 8 permission requests written up, data-handling questionnaire completed, 5 of 6 required walkthrough videos uploaded.
- **Two product bugs found & fixed while proving the new app** (both live on v1 and v2):
  - OAuth scope handling for newly-created Meta apps (PR #771).
  - Boosted-post ads were being rejected on Traffic/Signup campaigns after last week's destination fix — now resolved; boosts and link ads coexist cleanly (PR #777).
- **Proof launch:** 1 campaign, 12 audiences, 5 ad sets, 3 creatives, 10/10 ads created and in review through the new app.

## What's left before the Standard Access submission goes in (this week)

| Item | Owner | Status |
|---|---|---|
| API usage counters (Meta requires 500 calls @ ≥85% success) | Matas — just use v2 as the daily builder | Expected to clear on Meta's ~24h counter refresh |
| Final walkthrough video (pages_manage_ads) | Matas — file is in iCloud, needs download + upload | 10 min |
| Reviewer test login (allowlisted account for Meta's reviewer) | Matas + Claude (instructions text ready to write) | 15 min |
| Submit for review | Claude/Matas | After the above |

Meta's review turnaround is then in their hands; the submission is far stronger than the old app's (complete settings, real privacy/data-deletion URLs, working product to demo).

## Known limitations during transition

- **~60 motion ads across NX26 campaigns (EED, IPC, Modern Funktion) still show a placeholder thumbnail.** Decision taken: not repairing retroactively; all *new* launches ship correct thumbnails. Full repair capability arrives with Standard Access.
- **Instagram-linked audience building has a narrow gap on v2** for some non-BM client pages (Meta removed a legacy permission for new apps). Ads on IG placements are unaffected. Workaround exists via v1; permanent fix scoped for after Standard Access.
- One-off today: Meta placed a temporary security hold on API ad-creation after the burst of new-app activity — cleared same day; documented so it never costs us time again.

## Ops guidance this week

- **Build and launch through v2** wherever possible — every action counts toward the Standard Access usage requirement.
- v1 remains the fallback for anything IG-audience-dependent.
- Old duplicate/partial test campaigns from today's proving runs are being cleaned up — nothing is spending from them.

## After Standard Access lands (the unlock list)

- Higher rate limits → faster launches, no more 30-minute throttle waits, reliable hourly reporting syncs.
- `/adimages` capability → thumbnail repair for the 60 affected ads + removal of workarounds.
- Better insights headroom → supports the reporting/attribution roadmap without budget-juggling API calls.
