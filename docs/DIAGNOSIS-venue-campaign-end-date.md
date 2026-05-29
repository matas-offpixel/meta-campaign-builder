# DIAGNOSIS — Venue campaign end date bug

**Branch:** `cc/venue-campaign-end-date`  
**Date:** 2026-05-29  
**Status:** Phase 1 complete — awaiting Matas approval before Phase 2 implementation.

---

## The bug in one line

`displayVenueEventDate` returns `upcoming[0]` (MIN upcoming fixture date) instead of
`upcoming.at(-1)` (MAX upcoming fixture date = campaign end date).

---

## 1. Every place that reads "event date" for the Funnel Pacing tab

### Primary wiring — two page files (the bug site)

**`app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` — lines 181–228**

```typescript
const displayEventDate = displayVenueEventDate(venueEvents);  // BUG: returns upcoming[0]
const daysUntil = computeDaysUntil(displayEventDate);

const venueCanonical = buildVenueCanonicalFunnel({
  ...
  eventDate: displayEventDate,  // propagates the wrong date into ALL downstream calculations
  ...
});
```

**`app/share/venue/[token]/page.tsx` — lines 125–154**

Identical copy of the same pattern. Same bug, same propagation.

### The buggy function (identical in both files)

```typescript
function displayVenueEventDate(events: { event_date: string | null }[]): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events
    .map((event) => event.event_date)
    .filter((date): date is string => !!date && date >= today)
    .sort();
  if (upcoming.length > 0) return upcoming[0];  // ← BUG: returns FIRST (MIN), not LAST (MAX)
  return (
    events
      .map((event) => event.event_date)
      .filter((date): date is string => !!date)
      .sort()
      .at(-1) ?? null
  );
}
```

Ironically the **all-past fallback branch** already uses `.at(-1)` (MAX) correctly. Only the
upcoming-dates branch returns the wrong end of the sorted array.

### Secondary consumer — `FunnelPacingSection` prop

The `displayEventDate` is also passed as `venueEventDate` to `FunnelPacingSection` →
`FunnelPacingVenueView` → `FunnelProjectionChart` for the x-axis event-date marker.
That prop is a pure display label; it carries the same wrong date.

### Non-affected surfaces

- **`venue-event-breakdown.tsx`** — uses `daysUntilEvent(event.event_date)` per fixture
  (individual match countdown). Correct per-fixture semantics; no change needed.
- **`venue-daily-report-block.tsx`** — `earliestUpcomingOrKnownEventDate` stores
  `event_date` on `VenueEventLike` for the daily tracker model, but that field is
  **never consumed** in any rendering or calculation path (dead field). Out of scope.
- **`venue-report-header.tsx`** — receives `daysUntil` and `displayEventDate` as props
  from the page; no independent date computation. The header countdown chip will
  automatically correct once the page-level bug is fixed.

---

## 2. Every place that computes "days until event" or "days remaining"

The entire "days remaining" computation tree flows from the single `displayEventDate`
value built at page level:

```
displayVenueEventDate(venueEvents)              ← BUG HERE
  │
  ├── daysUntil = computeDaysUntil(displayEventDate)
  │     → VenueReportHeader DaysUntilChip (sticky header countdown)
  │
  └── buildVenueCanonicalFunnel({ eventDate: displayEventDate })
        │
        └── computeBackwardRead(... eventDate ...)
              │
              └── daysToEvent (canonical struct field)
                    │
                    ├── VenueSpendReconciliation.requiredPerDay
                    │     = (ticketsRemaining × liveCPT) / daysToEvent   ← denominator wrong
                    │
                    ├── VenueSpendReconciliation.warning / warningAmount
                    │     = requiredPerDay × daysToEvent > remaining      ← both factors wrong
                    │
                    ├── Hero Status Bar: "Days to event" segment
                    │
                    ├── Hero Daily Budget Readout: Budget / Required / Room
                    │
                    ├── Daily Spend Tracker: required-£/day reference line
                    │
                    ├── Spend vs Budget Reconciliation: stat tiles
                    │
                    ├── Pacing Verdict Card: headline ("over the next N days")
                    │     + "Why this number?" derivation
                    │
                    ├── Sliding Spend Scrubber:
                    │     totalAtPace = daily × daysToEvent + spent
                    │     budgetCeilingDaily = remaining / daysToEvent
                    │
                    └── Forward Projection Chart:
                          event-date marker + projection horizon
```

**Every Funnel Pacing calculation that mentions time is wrong.** There is no second path.

---

## 3. Performance Summary convergence check

**Finding: Performance Summary is NOT affected and does not read `eventDate`.**

The Performance tab's metric tiles (Reach / Clicks / LPV / Spend) read from:
- `portal.lifetimeMetaByEventCode` (for Reach/Clicks/LPV)
- `portal.dailyRollups` (for Spend)

Neither uses `eventDate`. The convergence contract from issue #467 / PR-B is about
engagement metric sources (both surfaces read the same lifetime-cache row) — not about
event dates. Performance Summary has no "days to event" tile.

The **one shared use** of `displayEventDate` outside Funnel Pacing is the
`VenueReportHeader.DaysUntilChip` (sticky header countdown). That chip will
auto-correct as a side-effect of the page-level fix — no separate change needed.

**Conclusion:** This is a Funnel-Pacing-only bug. Performance Summary is already correct
(it doesn't use the date). Fixing the two page files restores convergence between the
header countdown and the Funnel Pacing tab's daysToEvent without any additional changes.

---

## 4. Canonical builder input contract

`buildVenueCanonicalFunnel` accepts `eventDate: string | null`. The current JSDoc comment
reads "Earliest upcoming `event_date`" — that comment is wrong (it describes the
bug, not the intended semantics). The correct semantics are:

> **`venueCampaignEndDate`** — MAX(event_date) across all fixtures sharing this
> event_code. This is the date by which all tickets must be sold and all spend must
> be deployed. Drives `daysToEvent` in the backward read and all downstream
> spend-rate calculations.

The builder itself needs **no behavioral change** — it already accepts any ISO date
string and computes `daysToEvent` correctly from it. Only the comment needs updating to
match the corrected semantics (and as documentation for future callers).

---

## 5. Recommended fix point (option a — page-level wiring)

**Fix exactly two lines of code and two JSDoc comments.**

### Change 1: `displayVenueEventDate` in both page files

```typescript
// BEFORE (both files)
if (upcoming.length > 0) return upcoming[0];

// AFTER
if (upcoming.length > 0) return upcoming.at(-1)!;
```

This is the only change needed. The function already builds and sorts `upcoming` — we
just read the other end. The all-past fallback already uses `.at(-1)` correctly; this
makes the two branches consistent.

### Change 2: JSDoc on `buildVenueCanonicalFunnel`'s `eventDate` input

```typescript
// BEFORE
/**
 * Earliest upcoming `event_date` (or latest past one when all
 * fixtures are past). ...
 */
eventDate: string | null;

// AFTER
/**
 * Campaign end date for this venue — MAX(event_date) across all
 * fixtures sharing the same event_code. This is the date by which
 * all tickets must be sold and all spend deployed. Drives
 * `daysToEvent` in the backward read and all downstream spend-rate
 * calculations. `null` when no fixture dates are available.
 */
eventDate: string | null;
```

**No behavioral change to the builder.** It already accepts any date string.

### Why not options (b) or (c)?

- **(b) Internal aggregation inside the builder** — the builder is a pure-compute
  function that receives already-loaded data. Adding a DB aggregation or an events
  array parameter would widen its contract, require test changes, and create
  redundancy since the caller already has the events array.
- **(c) New helper `getVenueCampaignEndDate`** — adds indirection for a one-liner.
  The right abstraction is already there: `displayVenueEventDate` needs its return
  logic corrected, not replaced.

---

## 6. DB-verified impact (today = 2026-05-29)

| Venue | Current (bug) | After fix | Delta |
|-------|--------------|-----------|-------|
| WC26-EDINBURGH | 2026-06-13 → **15 days** | 2026-06-24 → **26 days** | +11 days |
| WC26-ABERDEEN | 2026-06-13 → **15 days** | 2026-06-24 → **26 days** | +11 days |
| WC26-GLASGOW-O2 | 2026-06-13 → **15 days** | 2026-06-24 → **26 days** | +11 days |
| WC26-GLASGOW-SWG3 | 2026-06-13 → **15 days** | 2026-06-24 → **26 days** | +11 days |
| WC26-BIRMINGHAM | 2026-06-17 → **19 days** | 2026-07-01 → **33 days** | +14 days |
| WC26-LONDON-KENTISH | 2026-06-17 → **19 days** | 2026-07-01 → **33 days** | +14 days |
| WC26-LONDON-SHEPHERDS | 2026-06-17 → **19 days** | 2026-07-01 → **33 days** | +14 days |
| WC26-KOC-HACKNEY | 2026-06-16 → **18 days** | 2026-06-24 → **26 days** | +8 days |
| 4TF26-ARSENAL-CL-FL | 2026-05-30 → **1 day** | 2026-05-30 → **1 day** | **0** (single-date venue) |
| UTB0043-New | 2026-07-26 → **58 days** | 2026-07-26 → **58 days** | **0** (single fixture) |

**Important note on Edinburgh "29 June Last 32":** The prompt mentioned a Last-32
fixture on 2026-06-29. That row does **not yet exist in the DB**. Once Matas or Cowork
inserts it, `MAX(event_date)` automatically becomes 2026-06-29 with no code change —
which is exactly the fallback rule Matas confirmed. The fix is already correct for
when that row lands.

### Required-per-day impact (Edinburgh example)

Given today (May 29):
- Tickets remaining: ~1,619 (capacity 5,475 − sold 3,856 as of last check)
- Live CPT ~£1.81

| | daysToEvent | requiredPerDay |
|--|-------------|----------------|
| Bug | 15 days | £1.81 × 1,619 / 15 = **~£196/day** |
| Fix | 26 days | £1.81 × 1,619 / 26 = **~£113/day** |

The bug **overstates the daily requirement by 73%** — causing red "under-pacing" alerts
for campaigns that are actually within a manageable budget. This is a significant
mis-signal.

---

## 7. File change count

| File | Change type |
|------|-------------|
| `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx` | One-liner + function name |
| `app/share/venue/[token]/page.tsx` | One-liner + function name |
| `lib/dashboard/venue-canonical-funnel.ts` | JSDoc comment update only |

**3 files total — well under the 6-file stop threshold.**

Regression tests will be added in `lib/dashboard/__tests__/venue-canonical-funnel.test.ts`
(already exists; just needs test cases for multi-fixture venues) plus a new test for
`displayVenueEventDate` logic — but those are test files, not production change risk.

---

## Awaiting Matas approval

This diagnosis is ready for review. Phase 2 (implementation) will begin once approved.
The implementation PR will be the same branch (`cc/venue-campaign-end-date`) with the
two-line fix, updated JSDoc, and regression tests.
