import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseEventbriteTiers } from "../eventbrite/parse.ts";
import { ticketTierCapacity } from "../tier-capacity.ts";

describe("parseEventbriteTiers", () => {
  it("maps Eventbrite ticket_classes into ticket tier breakdowns", () => {
    const tiers = parseEventbriteTiers({
      ticket_classes: [
        {
          name: "General Admission - 4 for 3 (Earlybird)",
          cost: { value: 611, major_value: "6.11", currency: "GBP" },
          quantity_total: 52,
          quantity_sold: 52,
          on_sale_status: "SOLD_OUT",
        },
        {
          name: "Final Release",
          cost: { value: 1200, major_value: "12.00", currency: "GBP" },
          quantity_total: 100,
          quantity_sold: 12,
        },
      ],
    });

    assert.deepEqual(tiers, [
      {
        tierName: "General Admission - 4 for 3 (Earlybird)",
        price: 6.11,
        quantitySold: 52,
        quantityAvailable: 0,
      },
      {
        tierName: "Final Release",
        price: 12,
        quantitySold: 12,
        quantityAvailable: 88,
      },
    ]);
    assert.equal(ticketTierCapacity(tiers), 152);
  });

  it("falls back to class capacity and minor-unit cost when needed", () => {
    const tiers = parseEventbriteTiers({
      ticket_classes: [
        {
          display_name: "Door",
          cost: { value: 500, currency: "GBP" },
          capacity: 20,
          quantity_sold: 7,
        },
      ],
    });

    assert.deepEqual(tiers, [
      {
        tierName: "Door",
        price: 5,
        quantitySold: 7,
        quantityAvailable: 13,
      },
    ]);
  });
});
