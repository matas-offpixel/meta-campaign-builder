[Use Opus]

# Two small hygiene items, one PR: delete an inert branch-gated test, and diagnose-then-fix the duplicate audience chips. `cursor/hygiene-inert-freeze-dup-chips`, off fresh `main`. Open, don't merge.

## 1 — Delete the dead freeze in `lib/__tests__/campaign-event.test.ts`

The test *"this branch does not touch evaluate/apply/gates/plan-workspace"* (~:321) starts with:

```ts
if (headRef !== "cursor/duplicate-must-choose-its-event") return;
```

That branch merged months ago. The test has returned early on every run since — it passes on every branch and guards nothing. It's the pattern #969/#972 replaced elsewhere. Delete the `it(...)` block and the `execSync`/`GITHUB_HEAD_REF` scaffolding if nothing else in the file uses it. Do not replace it with anything; the files it named are guarded by #972's golden payloads.

## 2 — `DHB Primary – USA` appears twice in the custom-audience chips

Matas saw the same audience rendered as two chips in the Audiences tab of an imported DHB draft. **Diagnose before fixing** — the DHB fixture (`lib/meta/import/__fixtures__/captured/`) is the input; re-map it and find where the duplicate comes from. Candidates, in order of likelihood:

- the same audience id in two of the source ad set's `custom_audiences` (Meta allows it) → one group carries it twice; dedupe by id in `mapMetaLiveCampaign` when building `audienceIds`;
- `#978`'s `audienceNames` and `#979`'s revert leaving the id in both a page-derived and a custom entry → a merge that never deduped;
- the chip component keying on name instead of id, and two different audiences sharing the name → then it's two real audiences and the chip needs the id (or a suffix) shown, not a dedupe.

Say which in the PR body with the ids. Fix at the source, not by filtering at render. If it's the third case, the fix is display, and the chip shows enough to tell them apart.

## Guards

No migration. No change to what launches — an ad set with the audience listed twice must still produce the same `custom_audiences` Meta accepted (Meta dedupes; the app should too, but assert the count sent is what Ads Manager shows for that ad set). Do not touch `lib/tiktok/**`, `lib/optimisation/**`, `lib/google-ads/**`, `lib/google-search/**`.

## Test plan

The deleted test is gone; the rest of `campaign-event.test.ts` green. DHB re-map: each audience id appears once per group — assert on the fixture; and a hand-built ad set with the same id twice in `custom_audiences` imports as one entry with a `dropped[]` note `duplicate_audience` (if that's the cause).

Full `npm test`, `npm run build`, check-run conclusions in the thread — not in a commit.
