import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  extractFourthefansEventArray,
  readFourthefansEventSales,
  readFourthefansEventSummary,
} from "../fourthefans/parse.ts";
import { fourthefansRetryDelayMs } from "../fourthefans/client.ts";

describe("FourthefansProvider", () => {
  it("uses Retry-After or a 60s default for 429 backoff", () => {
    assert.equal(fourthefansRetryDelayMs(0, 47_000, 429), 47_000);
    assert.equal(fourthefansRetryDelayMs(0, null, 429), 60_000);
    assert.equal(fourthefansRetryDelayMs(1, null, 429), 120_000);
  });

  it("lists events from the agency API response", async () => {
    const events = extractFourthefansEventArray({
      events: [
        {
          id: 123,
          title: "Boiler Room",
          event_date: "2026-06-12 19:00:00",
          venue: "The Prospect Building, Bristol",
          capacity: "1,200",
          url: "https://4thefans.book.tickets/e/123",
          status: "on_sale",
        },
      ],
      total_pages: 1,
    });

    const summaries = events
      .map((event) => readFourthefansEventSummary(event))
      .filter((event) => event != null);

    assert.deepEqual(summaries, [
      {
        externalEventId: "123",
        name: "Boiler Room",
        startsAt: "2026-06-12 19:00:00",
        url: "https://4thefans.book.tickets/e/123",
        venue: "The Prospect Building, Bristol",
        capacity: 1200,
        status: "on_sale",
      },
    ]);
  });

  it("parses current sales totals from an event detail payload", async () => {
    const sales = readFourthefansEventSales({
      data: {
        id: "evt_123",
        name: "Boiler Room",
        event_date: "2026-06-12T19:00:00+01:00",
        capacity: "1,200",
        tickets_sold: "345",
        revenue: "£12,345.67",
        currency: "GBP",
      },
    });

    assert.equal(sales.ticketsSold, 345);
    assert.equal(sales.ticketsAvailable, 1200);
    assert.equal(sales.grossRevenueCents, 1234567);
    assert.equal(sales.currency, "GBP");
  });
});
