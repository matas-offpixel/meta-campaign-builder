/**
 * A venue with no Internal Counts (Electric Studios on 15 Nov): Total sold,
 * Sales and the trajectory said "Internal Counts, 15 Nov" / "count of 15 Nov",
 * borrowing the spend date. With no counts in scope they say so.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { phoneSpan } from "@/components/dashboard/sales/phone-copy";
import { SalesDashboard } from "@/components/dashboard/sales/sales-dashboard";
import { NO_TICKET_COUNTS_LINE, NO_TICKET_COUNTS_WORDS, tileSubline } from "@/components/dashboard/sales/tile-copy";
import { NO_COUNTS_BAR, buildSalesDashboard } from "@/lib/dashboard/sales-calc/model";
import { LIVE_LIKE_INPUT } from "@/lib/dashboard/sales-live-like-input";
import { NO_TICKET_COUNTS, type SalesSurface } from "@/lib/dashboard/sales-vs-spend";

afterEach(() => {
  cleanup();
});

/** The live-like rows with Electric Studios' one show (Fever 105) not counted yet. */
function noStudiosCounts() {
  const input = structuredClone(LIVE_LIKE_INPUT);
  for (const show of input.shows) {
    if (show.venueKey !== "electric studios") continue;
    show.counts = [];
    show.finalCount = null;
  }
  return buildSalesDashboard(input).model;
}

const MODEL = noStudiosCounts();
const STUDIOS = "venue:electric studios";
const SURFACES: SalesSurface[] = ["internal", "share"];

function tileLabel(name: string): string {
  return screen.getByRole("button", { name: new RegExp(`^${name}, `) }).getAttribute("aria-label") ?? "";
}

describe("the words stay in step with the model", () => {
  it("no ticket counts yet", () => {
    expect(NO_TICKET_COUNTS_WORDS).toBe(NO_TICKET_COUNTS);
    expect(NO_TICKET_COUNTS_LINE).toBe(NO_COUNTS_BAR);
  });
});

describe("the model: a venue with no counts has no count date", () => {
  it("Electric Studios has countDay null and 0 counted shows; Electric Bristol and All venues keep 12 Nov", () => {
    expect(MODEL.views[STUDIOS].countDay).toBeNull();
    expect(MODEL.views[STUDIOS].showCounts).toEqual({ counted: 0, shows: 1 });
    expect(MODEL.views["venue:electric bristol"].countDay).toBe("2026-11-12");
    expect(MODEL.views.all.countDay).toBe("2026-11-12");
  });
});

describe.each(SURFACES)("%s: Electric Studios with no counts", (surface) => {
  it("Total sold, Sales and Cost per ticket say 'no ticket counts yet', never a date", () => {
    render(<SalesDashboard model={MODEL} surface={surface} initialShowId={STUDIOS} initialVenueKey="electric studios" initialPeriod="launch" />);
    expect(tileLabel("Total sold")).toBe("Total sold, —, to date · no ticket counts yet");
    expect(tileLabel("Sales")).toBe("Sales, —, since launch · no ticket counts yet");
    expect(tileLabel("Cost per ticket")).toBe("Cost per ticket, —, since launch · no ticket counts yet");
    expect(document.body.textContent).not.toMatch(/Internal Counts, \d|count of \d|the 0 shows/);
  });

  it("the trajectory's Sold tile and legend carry no count date, and Projected is no '0–0'", () => {
    const { container } = render(
      <SalesDashboard model={MODEL} surface={surface} initialShowId={STUDIOS} initialVenueKey="electric studios" initialPeriod="launch" />,
    );
    const tiles = [...container.querySelectorAll("li")];
    const sold = tiles.find((li) => li.textContent?.startsWith("Sold") && li.className.includes("rounded-md"))!;
    expect(sold.textContent).toBe("Sold—No ticket counts yet");
    expect(screen.getByText("Sold", { selector: "li" })).toBeTruthy();
    const projected = tiles.find((li) => li.textContent?.startsWith("Projected on show day"))!;
    expect(projected.textContent).not.toContain("0–0");
    // The show's own bar already said so.
    expect(screen.getAllByText("No ticket counts yet").length).toBeGreaterThan(1);
  });

  it("in a period, the same: no borrowed date anywhere", () => {
    render(<SalesDashboard model={MODEL} surface={surface} initialShowId={STUDIOS} initialVenueKey="electric studios" initialPeriod="7" />);
    expect(tileLabel("Total sold")).toBe("Total sold, —, to date · no ticket counts yet");
    expect(tileLabel("Sales")).toBe("Sales, —, in 7 days · no ticket counts yet");
    expect(document.body.textContent).not.toMatch(/Internal Counts, \d|count of \d/);
  });

  it("the show itself (Fever 105) says the same", () => {
    render(<SalesDashboard model={MODEL} surface={surface} initialShowId="es26-fever105" initialVenueKey="electric studios" initialPeriod="launch" />);
    expect(tileLabel("Total sold")).toBe("Total sold, —, to date · no ticket counts yet");
    expect(tileLabel("Sales")).toBe("Sales, —, since launch · no ticket counts yet");
  });
});

describe.each(SURFACES)("%s: venues with counts are unchanged", (surface) => {
  it("All venues keeps 'Internal Counts, 12 Nov' and 'count of 12 Nov'", () => {
    render(<SalesDashboard model={MODEL} surface={surface} initialShowId="all" initialVenueKey="all" initialPeriod="launch" />);
    expect(tileLabel("Total sold")).toContain("to date · Internal Counts, 12 Nov");
    expect(tileLabel("Sales")).toBe(`Sales, ${MODEL.views.all.tiles.find((t) => t.id === "tickets")!.value}, since launch, to 12 Nov`);
    expect(document.body.textContent).toContain("Sold, count of 12 Nov");
  });

  it("Electric Bristol keeps its count date", () => {
    render(<SalesDashboard model={MODEL} surface={surface} initialShowId="venue:electric bristol" initialVenueKey="electric bristol" initialPeriod="launch" />);
    expect(tileLabel("Total sold")).toContain("Internal Counts, 12 Nov");
    expect(tileLabel("Sales")).toContain("since launch, to 12 Nov");
  });
});

describe("phone spans with no counts", () => {
  const tile = { narrowDetail: NO_TICKET_COUNTS, title: "" };
  it("Total sold and Sales say 'no ticket counts yet'; Cost per ticket names no count", () => {
    expect(phoneSpan("sold", "launch", null, tile)).toBe("no ticket counts yet");
    expect(phoneSpan("tickets", "launch", null, tile)).toBe("no ticket counts yet");
    expect(phoneSpan("tickets", "7", null, tile)).toBe("in 7 days");
    expect(phoneSpan("costPerTicket", "launch", null, tile)).toBe("since launch");
  });

  it("with a count date, unchanged", () => {
    expect(phoneSpan("tickets", "launch", "12 Nov", tile)).toBe("since launch, to 12 Nov");
    expect(phoneSpan("costPerTicket", "launch", "12 Nov", tile)).toBe("spend to the 12 Nov count");
  });
});

describe("tileSubline with no counts", () => {
  it("Total sold, Sales since launch and Cost per ticket", () => {
    expect(tileSubline("sold", NO_TICKET_COUNTS, "launch", null)).toBe("to date · no ticket counts yet");
    expect(tileSubline("sold", NO_TICKET_COUNTS, "14", null)).toBe("to date · no ticket counts yet");
    expect(tileSubline("tickets", NO_TICKET_COUNTS, "launch", null)).toBe("since launch · no ticket counts yet");
    expect(tileSubline("costPerTicket", NO_TICKET_COUNTS, "launch", null, { showsWithCounts: 0, shows: 1 }, true)).toBe(
      "since launch · no ticket counts yet",
    );
  });

  it("with a count date, unchanged", () => {
    expect(tileSubline("sold", "to date · Internal Counts, 12 Nov", "launch", "12 Nov")).toBe("to date · Internal Counts, 12 Nov");
    expect(tileSubline("tickets", "since launch, to 12 Nov", "launch", "12 Nov")).toBe("since launch, to 12 Nov");
  });
});
