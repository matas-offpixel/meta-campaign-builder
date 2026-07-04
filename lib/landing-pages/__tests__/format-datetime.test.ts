import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatOnSaleHeaderLabel,
  formatPresaleNotifyDate,
} from "../format-datetime.ts";

/**
 * PR 7: copy-sensitive date formatters extracted from the component tree
 * specifically so the exact strings Matas specified are pinned here
 * rather than eyeballed in JSX. Both are always Europe/London.
 */

describe("formatOnSaleHeaderLabel", () => {
  it('"On sale: HH:mm EEE d MMMM" in BST (summer, +1h vs UTC)', () => {
    // 2026-07-08 10:00 UTC → 11:00 BST, Wednesday.
    assert.equal(
      formatOnSaleHeaderLabel("2026-07-08T10:00:00Z"),
      "On sale: 11:00 Wed 8 July",
    );
  });

  it("in GMT (winter, no offset)", () => {
    assert.equal(
      formatOnSaleHeaderLabel("2026-01-10T12:00:00Z"),
      "On sale: 12:00 Sat 10 January",
    );
  });

  it("Title Case is deliberate — 'On sale' stays capitalised, weekday/month keep Intl's casing", () => {
    const label = formatOnSaleHeaderLabel("2026-07-08T10:00:00Z");
    assert.ok(label.startsWith("On sale:"));
    assert.ok(!label.startsWith("on sale:"));
  });
});

describe("formatPresaleNotifyDate", () => {
  it('"d MMM at HH:mm" — the post-signup confirmation fragment', () => {
    assert.equal(
      formatPresaleNotifyDate("2026-07-08T10:00:00Z"),
      "8 Jul at 11:00",
    );
  });

  it("single-digit day has no leading zero (numeric, not 2-digit)", () => {
    assert.equal(
      formatPresaleNotifyDate("2026-07-01T09:00:00Z"),
      "1 Jul at 10:00",
    );
  });
});
