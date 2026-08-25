# The Multichannel Engine — roadmap v1 (SUPERSEDED by V2)

> **STATUS: superseded.** See `MULTICHANNEL_ENGINE_ROADMAP_V2_2026-08-21.md` (canonical,
> funnel-first) and `MULTICHANNEL_ENGINE_ROADMAP_AUDIT_2026-08-21.md` (the Opus audit whose
> production queries falsified three of this document's premises: the rollup tickets leg is
> dead since July, the attribution spine has ~no adoption, and July spend is 98.8% Meta).
> Retained for the Northbeam dissection (§1), design decisions (§4) and rules of the road
> (§5), which v2 carries forward.

## 1. Northbeam dissected

Northbeam is three layers, each feeding the next: **MTA** (a trustworthy join of platform
spend × first-party conversions), **MMM+** (decisioning on that join: daily forecasts,
allocations, promo sensitivity), **Apex** (write-back of attribution data into Meta/Axon
algorithms). Their own copy admits the dependency: the model is only as good as the join.

Four structural advantages Northbeam does not have: (1) we LAUNCH — they only measure; the
three working launchers are the moat; (2) we own the landing pages — their first-party data
depends on a pixel on someone else's site, we ARE the site; (3) events beat e-commerce for
modelling — they infer "key sales periods", we know announce/presale/on-sale boundaries
deterministically; (4) the event is the join key — no user-level identity resolution needed.

Two structural disadvantages designed for rather than ignored: £25–50/day budgets mean low
statistical power per event (pool curves, never fit per event); purchase attribution is
per-client (label deterministic vs platform-reported vs modelled, always).

## 4. Design decisions (carried into v2)

1. **Orchestrate, never rebuild** — the plan layer prefills per-platform drafts and calls the
   EXISTING launch routes; each platform keeps its preflight, killswitch and rollback.
   Partial success is a first-class plan state.
2. **Intent → adapter mapping** — plans store platform-neutral intent and an audience
   cluster; per-platform adapters translate. Plans never store platform enums.
3. **Deterministic attribution or labelled** — superseded by v2's funnel framing, provenance
   labels retained.
4. **Recommendations are rows before they are writes** — the #120 3-gate pattern
   (env killswitch AND per-plan enabled AND per-plan live); recommend-only is the default.
5. **Additive schema; migrations via the established discipline**; old drafts always load.
6. **Daily budgets as the common denominator**; per-platform minimums enforced at PLAN
   preflight (e.g. TikTok £50/day GBP per ad group).

## 5. Rules of the road (bake into every prompt)

- **SDK models first.** External field names/capabilities from the vendor's SDK model files
  (raw.githubusercontent), then logged response envelopes, then prose docs, NEVER error
  strings. Session score: guessing 0/6, SDK 6/6; TikTok's docs contradicted TikTok's API 4×.
- **Assert invariants, not literals** — literal expected lists get rewritten to match broken
  output (happened 4× in one day).
- **No silent fallbacks, no success-shaped failures** — empty ≠ none; name the condition; a
  guard must validate the value the write actually uses.
- **Log the full outgoing payload** on every new external write path (console.error — the
  only level surviving Vercel filtering).
- **Falsify before fix** — new tests must fail against the prior sha; ship reports say so.
- **One PR per branch off fresh main; deliberate rebases; re-read after rebase.**

(Original v1 phase plan removed — see the audit for its summary and v2 for the current path.)
