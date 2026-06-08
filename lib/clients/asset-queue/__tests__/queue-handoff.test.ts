import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssetQueueRow } from "@/lib/db/asset-queue";
import {
  isQueueBulkAttachHandoffStatus,
  isUmbrellaQueueRow,
  resolveQueueHandoffCopy,
  UMBRELLA_VENUE_WIDE_DEFAULT_COPY,
} from "../queue-handoff.ts";

function baseRow(overrides: Partial<AssetQueueRow> = {}): AssetQueueRow {
  return {
    id: "q-1",
    client_id: "c-1",
    status: "pending",
    asset_name: "Haiti Fixture",
    generated_copy: "Prepared copy",
    generated_cta: "BOOK_NOW",
    generated_url: "",
    resolved_event_code: null,
    resolved_event_codes_multi: ["WC26-ABERDEEN", "WC26-EDINBURGH"],
    confirmed_overrides: null,
    ...overrides,
  } as AssetQueueRow;
}

describe("queue-handoff", () => {
  it("detects umbrella rows from resolved_event_codes_multi", () => {
    assert.equal(isUmbrellaQueueRow(baseRow()), true);
    assert.equal(
      isUmbrellaQueueRow(
        baseRow({ resolved_event_codes_multi: [], resolved_event_code: "WC26-BRIGHTON" }),
      ),
      false,
    );
  });

  it("accepts pending and confirmed for bulk-attach handoff", () => {
    assert.equal(isQueueBulkAttachHandoffStatus("pending"), true);
    assert.equal(isQueueBulkAttachHandoffStatus("confirmed"), true);
    assert.equal(isQueueBulkAttachHandoffStatus("matched"), false);
  });

  it("uses row fields for pending handoff", () => {
    const copy = resolveQueueHandoffCopy(
      baseRow({
        status: "pending",
        generated_copy: "Row copy",
        generated_cta: "WATCH_MORE",
        generated_url: "https://example.com",
      }),
    );
    assert.deepEqual(copy, {
      generatedCopy: "Row copy",
      generatedCta: "WATCH_MORE",
      generatedUrl: "https://example.com",
    });
  });

  it("merges confirmed_overrides for confirmed umbrella rows", () => {
    const copy = resolveQueueHandoffCopy(
      baseRow({
        status: "confirmed",
        generated_copy: "Old prepared copy",
        generated_cta: "BOOK_NOW",
        generated_url: "",
        confirmed_overrides: {
          primaryText: "Modal copy",
          ctaValue: "WATCH_MORE",
          destUrl: "https://tickets.example.com",
        },
      }),
    );
    assert.deepEqual(copy, {
      generatedCopy: "Modal copy",
      generatedCta: "WATCH_MORE",
      generatedUrl: "https://tickets.example.com",
    });
  });

  it("exports umbrella venue-wide default copy constant", () => {
    assert.match(UMBRELLA_VENUE_WIDE_DEFAULT_COPY, /FINAL TICKETS/);
  });
});
