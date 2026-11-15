/** Dashboard v2 on a phone (docs/design-record/2026-11-14-dashboard-v2-phone.html, HMB2 + HMB3). */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { labelCut, readoutText, visibleRange, indexAt, PHONE_WINDOW_DAYS } from "@/components/dashboard/sales/phone-chart";
import {
  campaignsRow,
  moreFiguresLabel,
  phoneBar,
  phoneSpan,
  projectedSpan,
  stampLine,
  trajectoryTitle,
} from "@/components/dashboard/sales/phone-copy";
import { SalesDashboard } from "@/components/dashboard/sales/sales-dashboard";
import { NX_SALES_LIVE_LIKE } from "@/lib/dashboard/sales-vs-spend-fixture";
import type { SalesChartPoint } from "@/lib/dashboard/sales-vs-spend";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const view = NX_SALES_LIVE_LIKE.views["venue:nx newcastle"];

describe("the record's words on a phone", () => {
  it("MB3: the six key figures' span lines, as MBV1", () => {
    const tile = (id: string) => view.tiles.find((t) => t.id === id)!;
    expect(phoneSpan("spend", "launch", "12 Nov", tile("spend"))).toBe("since launch");
    expect(phoneSpan("sold", "launch", "12 Nov", tile("sold"))).toBe("Internal Counts, 12 Nov");
    expect(phoneSpan("costPerTicket", "launch", "12 Nov", tile("costPerTicket"))).toBe("spend to the 12 Nov count");
    expect(phoneSpan("registrations", "launch", "12 Nov", tile("registrations"))).toBe("show pages, to date");
    expect(phoneSpan("spend", "30", "12 Nov", tile("spend"))).toBe("in 30 days");
    expect(phoneSpan("costPerTicket", "launch", "12 Nov", { narrowDetail: "", title: "… on spend to each show's last count (latest 12 Nov)." })).toBe(
      "spend to each show's last count",
    );
  });

  it("MB4: the eight under More figures, as MBV4", () => {
    const span = (id: Parameters<typeof phoneSpan>[0]) => phoneSpan(id, "launch", "12 Nov", { narrowDetail: "", title: "" });
    expect(span("tickets")).toBe("since launch, to 12 Nov");
    expect(span("checkoutActions")).toBe("since launch · actions");
    expect(span("costPerCheckout")).toBe("Meta spend only");
    expect(span("lpv")).toBe("since launch");
    expect(span("costPerLpv")).toBe("Meta spend only");
    expect(span("clicks")).toBe("since launch");
    expect(span("cpc")).toBe("Meta spend only");
    expect(span("costPerRegistration")).toBe("inside signup windows");
    expect(moreFiguresLabel(false, 8)).toEqual({ action: "More figures (8)", hint: "sales, checkouts, LPVs, clicks, costs" });
    expect(moreFiguresLabel(true, 8)).toEqual({ action: "Fewer figures", hint: "8 more shown" });
  });

  it("MB2, MB3, MB7: stamps, Projected, the trajectory title and bars, the campaigns row", () => {
    expect(stampLine(NX_SALES_LIVE_LIKE.freshness)).toBe("Counts 12 Nov · Spend 13 Nov · Signups 13 Nov");
    const t = view.trajectory;
    if (t.kind !== "all") throw new Error("all");
    expect(projectedSpan(t.summary!.projected)).toMatch(/^on show day · up to \d+%$/);
    expect(trajectoryTitle(t.bars)).toBe("Sales trajectory · capacity 2,000 each");
    expect(phoneBar(t.bars[0]).name).toBe("Interplanetary Criminal");
    expect(phoneBar(t.bars[0]).figures).toMatch(/^1,828 → [\d,]+–[\d,]+$/);
    expect(phoneBar(t.bars.find((b) => b.label.startsWith("Schak"))!)).toEqual({ name: "Schak", figures: "1,870 → sells out" });
    expect(campaignsRow(view.campaigns)).toBe("Campaigns · 29 · 7 spending");
  });
});

describe("the live-like page is one consistent set of figures (design's note on #1232)", () => {
  it("header, tiles, stamps and campaigns come from the same rows through the calc", () => {
    expect(view.header!.sentence).toBe(
      "NX Newcastle to date: £14,216 spend since launch, 6,795 tickets sold across 7 shows (Internal Counts, 12 Nov), so £2.08 of spend per ticket, on spend to the 12 Nov count. Separate NX Newcastle umbrella spend: £4,309.",
    );
    expect(view.header!.channelLine).toBe("Meta £14,078 · TikTok £119 · Google £19 · to 13 Nov · finished shows not included");
    const tile = (id: string) => view.tiles.find((t) => t.id === id)!.value;
    expect([tile("spend"), tile("sold"), tile("costPerTicket"), tile("registrations")]).toEqual(["£14,216", "6,795", "£2.08", "4,276"]);
    expect(stampLine(NX_SALES_LIVE_LIKE.freshness)).toBe("Counts 12 Nov · Spend 13 Nov · Signups 13 Nov");
    expect(campaignsRow(view.campaigns)).toBe("Campaigns · 29 · 7 spending");
    expect(view.countDay).toBe("2026-11-12");
  });
});

describe("MB6 phone chart helpers", () => {
  const point = (over: Partial<SalesChartPoint>): SalesChartPoint => ({ day: "2026-09-30", estimated: false, count: false, estimateNote: null, values: {}, ...over });

  it("the readout names a count, or says the day is an estimate (D5)", () => {
    expect(readoutText(point({ count: true, values: { spend: 164, sold: 4173 } }), ["spend", "sold"])).toBe("30 Sep · Spend £164 · Total sold 4,173 · Internal Count");
    expect(
      readoutText(point({ day: "2026-10-03", estimated: true, estimateNote: "Estimated between counts on 1 Oct and 5 Oct", values: { spend: 190, sold: 4303 } }), ["spend", "sold"]),
    ).toBe("3 Oct · Spend £190 · Total sold 4,303 · Estimated between counts on 1 Oct and 5 Oct");
  });

  it("the range in view, the day under a finger, and labels the frame's edge would cut", () => {
    expect(visibleRange(91, 0, 0, 0)).toEqual([61, 90]);
    expect(visibleRange(91, 559, 275, 834)).toEqual([61, 90]);
    expect(visibleRange(91, 0, 275, 834)).toEqual([0, 29]);
    expect(indexAt(0.5, 91)).toBe(45);
    expect(labelCut(50, { left: 0, client: 275, width: 834 })).toBe(true);
    expect(labelCut(20, { left: 0, client: 275, width: 834 })).toBe(false);
  });
});

describe("the phone layout renders (CSS below 640 px; desktop markup unchanged)", () => {
  it("six key figures, More figures (8) closed by default, then Fewer figures with the chart toggles", () => {
    const { container } = render(<SalesDashboard model={NX_SALES_LIVE_LIKE} surface="share" initialShowId="venue:nx newcastle" initialPeriod="launch" />);
    const more = container.querySelector("[data-more-figures]")!;
    expect(more.textContent).toContain("More figures (8)");
    // The phone's Pace tile (the desktop trajectory has the same figure in its own tile).
    const t = view.trajectory;
    if (t.kind !== "all" || !t.summary) throw new Error("all");
    expect(screen.getAllByText(t.summary.pace.value.replace(/ a day$/, "")).length).toBe(2);
    expect(screen.getByText(projectedSpan(t.summary.projected))).toBeTruthy();
    // Folded tiles are hidden on a phone, shown from 640 px.
    const lpvTile = screen.getByRole("button", { name: /^Landing page views, / }).closest("li")!;
    expect(lpvTile.className).toContain("hidden sm:block");
    fireEvent.click(more);
    expect(container.querySelector("[data-more-figures]")!.textContent).toContain("Fewer figures");
    expect(screen.getByRole("button", { name: /^Landing page views, / }).closest("li")!.className).not.toContain("hidden sm:block");
    expect(screen.getByText("Chart lines")).toBeTruthy();
  });

  it("the period is one select chip; a change writes ?period", () => {
    const calls: unknown[] = [];
    render(<SalesDashboard model={NX_SALES_LIVE_LIKE} surface="share" initialShowId="venue:nx newcastle" initialPeriod="launch" onQuery={(u) => calls.push(u)} />);
    expect(screen.getByText("Since launch ▾")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "14" } });
    expect(calls).toEqual([{ period: "14" }]);
  });

  it("campaigns collapse to one row on a phone; a tap opens the table in its own scrolling frame", () => {
    const { container } = render(<SalesDashboard model={NX_SALES_LIVE_LIKE} surface="share" initialShowId="venue:nx newcastle" initialPeriod="launch" />);
    const row = screen.getByRole("button", { name: /Campaigns · 29 · 7 spending/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll("table").length).toBe(2);
  });

  it("the 30-day scroller for longer periods, none at 30 days or less", () => {
    const launch = render(<SalesDashboard model={NX_SALES_LIVE_LIKE} surface="share" initialShowId="venue:nx newcastle" initialPeriod="launch" />);
    expect(view.points.length).toBeGreaterThan(PHONE_WINDOW_DAYS);
    expect(launch.container.querySelector("[data-phone-chart]")).toBeTruthy();
    cleanup();
    const fourteen = render(<SalesDashboard model={NX_SALES_LIVE_LIKE} surface="share" initialShowId="venue:nx newcastle" initialPeriod="14" />);
    expect(fourteen.container.querySelector("[data-phone-chart]")).toBeNull();
  });

  it("press and hold (300 ms) shows the readout over the titles row; release puts the range back", () => {
    vi.useFakeTimers();
    const { container } = render(<SalesDashboard model={NX_SALES_LIVE_LIKE} surface="share" initialShowId="venue:nx newcastle" initialPeriod="launch" />);
    const plot = container.querySelector("[data-phone-chart] [data-phone-plot] .select-none")!;
    expect(container.querySelector("[data-range]")).toBeTruthy();
    fireEvent.pointerDown(plot, { clientX: 10, pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(container.querySelector("[data-readout]")).toBeTruthy();
    fireEvent.pointerUp(plot);
    expect(container.querySelector("[data-readout]")).toBeNull();
    expect(container.querySelector("[data-range]")).toBeTruthy();
  });

  it("a frame can pin a held day: 30 Sep reads as an Internal Count", () => {
    const { container } = render(
      <SalesDashboard model={NX_SALES_LIVE_LIKE} surface="share" initialShowId="venue:nx newcastle" initialPeriod="launch" phoneHoldDay="2026-09-30" />,
    );
    expect(container.querySelector("[data-readout]")!.textContent).toMatch(/^30\u00a0Sep · Spend £[\d,.]+ · Total sold [\d,]+ · Internal Count$/);
  });
});
