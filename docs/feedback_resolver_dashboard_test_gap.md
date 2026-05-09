# Feedback memory: resolver-level tests ≠ dashboard-level tests

**Anchored from:** PR #368 / fix/resolver-read-tier-channel-sales (2026-05-09)

## What happened

PR #368 fixed `resolveDisplayTicketCount` to surface multi-channel ticket totals.
Its test suite (`event-tickets-resolver.test.ts`) passed green — but it tested the
_resolver in isolation_, feeding it inputs that were already correct.

The actual bug was one layer above: the **data-loader** (`loadPortalForClientId`)
never passed `tier_channel_sales` data into the resolver call. The resolver's Math.max
never saw 1,362 (Manchester's true total) because nobody gave it that number. Tests
at the resolver level cannot catch a missing data-loader wire-up.

Manchester showed `699 / 13,538 SOLD` instead of `1,362 / 13,538 SOLD` because:
- `event_ticket_tiers.quantity_sold` = 699 (4TF connector write target)
- `latest_snapshot_tickets` = 699 (same source — ticket_sales_snapshots)
- `tier_channel_sales` sum = 1,362 (4TF 699 + Venue 663) — **never passed in**
- Math.max(699, 699) = 699 ← wrong

## The rule

> **Every resolver fix must ship with two tests:**
> 1. A unit test at the resolver level (inputs → expected output).
> 2. An integration/pipeline test that constructs a realistic `PortalEvent`-like fixture
>    — including the data-loader aggregation step — and asserts the **computed venue total**
>    produced by the full call chain, not just the isolated function.

The integration test catches missing wire-ups that a unit test cannot see.

## Ideal future: DOM-level smoke test

The gold standard is a Playwright test against the real rendered page:

```
// After merge:
await page.goto('/clients/37906506-56b7-4d58-ab62-1b042e2b561a/dashboard');
const manchesterCard = page.locator('[data-venue="WC26-MANCHESTER"]');
await expect(manchesterCard.locator('[data-testid="tickets-pill"]')).toContainText('1,362');
```

Until the E2E harness exists, the pipeline integration test in
`lib/dashboard/__tests__/manchester-venue-ticket-pipeline.test.ts` is the
next-best gate. Add `data-venue` and `data-testid` attributes when implementing
the venue card Playwright surface.

## Checklist for future resolver fixes

- [ ] Add unit test: resolver function with known inputs → expected output
- [ ] Add pipeline test: data-loader aggregation → resolver call → computed total
- [ ] Add Playwright test (when harness available): navigate to dashboard → assert cell text
- [ ] Check ALL callers pass the new input field — grep for the function name across the whole repo
