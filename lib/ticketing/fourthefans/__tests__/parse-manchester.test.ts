import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { readFourthefansEventSales } from "../parse.ts";

describe("readFourthefansEventSales Manchester tier shapes", () => {
  it("reads tiers nested under tier_groups.*.tickets", () => {
    const sales = readFourthefansEventSales({
      data: {
        id: 46,
        name: "England v Croatia",
        tickets_sold: 356,
        revenue: "£3069.00",
        tier_groups: [
          {
            name: "General Admission",
            tickets: [
              {
                name: "GA - 4 for 3 (Earlybird)",
                price: "£7.50",
                quantity_sold: 124,
                quantity_available: 0,
              },
              {
                name: "GA (Earlybird)",
                price: "£10.00",
                sold_count: 41,
                remaining: 0,
              },
            ],
          },
          {
            name: "Family",
            tickets: [
              {
                ticket_name: "Family Seated (3rd Release)",
                amount: "15.00",
                tickets_sold: 32,
                capacity: 45,
              },
            ],
          },
        ],
      },
    });

    assert.equal(sales.ticketsSold, 356);
    assert.equal(sales.grossRevenueCents, 306900);
    assert.deepEqual(sales.ticketTiers, [
      {
        tierName: "GA - 4 for 3 (Earlybird)",
        price: 7.5,
        quantitySold: 124,
        quantityAvailable: 0,
      },
      {
        tierName: "GA (Earlybird)",
        price: 10,
        quantitySold: 41,
        quantityAvailable: 0,
      },
      {
        tierName: "Family Seated (3rd Release)",
        price: 15,
        quantitySold: 32,
        quantityAvailable: 13,
      },
    ]);
  });

  it("reads tiers nested under groups.*.tickets and categories.*.tickets", () => {
    const sales = readFourthefansEventSales({
      event: {
        id: 61,
        name: "England v Panama",
        total_sold: 540,
      },
      groups: [
        {
          label: "Standing",
          tickets: [
            {
              title: "GA (Final Release)",
              ticket_price: "10",
              sold: 300,
              allocation: 400,
            },
          ],
        },
      ],
      categories: [
        {
          label: "Premium",
          tickets: [
            {
              label: "Sports Bar Premium Seated (Final Release)",
              price: "30",
              quantity_sold: 40,
              quantity_available: 60,
            },
          ],
        },
      ],
    });

    assert.equal(sales.ticketsSold, 540);
    assert.equal(sales.ticketTiers.length, 2);
    assert.equal(sales.ticketTiers[0]?.tierName, "GA (Final Release)");
    assert.equal(sales.ticketTiers[0]?.quantitySold, 300);
    assert.equal(sales.ticketTiers[1]?.tierName, "Sports Bar Premium Seated (Final Release)");
    assert.equal(sales.ticketTiers[1]?.quantitySold, 40);
  });
});
