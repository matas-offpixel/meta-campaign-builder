/** Design on #1234 at 93aa88f: the trajectory's words point at each show's recent pace (D6), not the Pace tile; yesterday's Cost per ticket. */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SalesDashboard } from "@/components/dashboard/sales/sales-dashboard";
import { NO_COUNT_YESTERDAY_WORDS, tileSubline } from "@/components/dashboard/sales/tile-copy";
import { barOutcome } from "@/components/dashboard/sales/trajectory-bars";
import { NO_COUNT_YESTERDAY } from "@/lib/dashboard/sales-calc/model";
import { NX_SALES_LIVE_LIKE } from "@/lib/dashboard/sales-vs-spend-fixture";

afterEach(() => {
  cleanup();
});

describe("item 4: the projection keeps D6's per-show rates; the words say so", () => {
  it("legend, Projected subline and the sells-out label", () => {
    const { container } = render(<SalesDashboard model={NX_SALES_LIVE_LIKE} surface="share" initialShowId="venue:nx newcastle" initialPeriod="launch" />);
    expect(screen.getByText("Holds at each show's recent pace")).toBeTruthy();
    expect(screen.getAllByText(/ · each show at its recent pace$/).length).toBeGreaterThan(0);
    // "SELLS OUT at its recent pace": the mark, then the words, on a bar whose holds case reaches capacity.
    expect(container.textContent).toContain("SELLS OUT at its recent pace");
    expect(container.textContent).not.toMatch(/last 7 days' pace|SELLS OUT at this pace/);
  });

  it("barOutcome names the recent pace", () => {
    expect(barOutcome({ id: "s", label: "Schak · 18 Dec", sold: 1870, low: 2000, high: 2000, allocation: 2000, caption: "", sellsOut: "holds" }).sellout).toBe(
      "at its recent pace",
    );
  });
});

describe("item 3: yesterday with no count", () => {
  it("Cost per ticket's subline reads the same words as Sales", () => {
    expect(NO_COUNT_YESTERDAY_WORDS).toBe(NO_COUNT_YESTERDAY);
    expect(tileSubline("costPerTicket", NO_COUNT_YESTERDAY, "yesterday", "12 Nov", { showsWithCounts: 7, shows: 8 }, true)).toBe("yesterday · no count yesterday");
    expect(tileSubline("tickets", NO_COUNT_YESTERDAY, "yesterday", "12 Nov")).toBe("yesterday · no count yesterday");
  });
});
