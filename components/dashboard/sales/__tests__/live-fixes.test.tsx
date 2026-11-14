/** Live-check fixes (14 Nov, design-ruled): one count date in the page, and one date formatter in the chart. */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SalesChart } from "@/components/dashboard/sales/sales-chart";
import { SalesDashboard } from "@/components/dashboard/sales/sales-dashboard";
import { NX_SALES_FIXTURE } from "@/lib/dashboard/sales-vs-spend-fixture";
import type { SalesChartPoint, SalesDashboardModel } from "@/lib/dashboard/sales-vs-spend";

afterEach(() => {
  cleanup();
});

const NBSP = " ";

describe("one count date", () => {
  it("Total sold, Sales and the trajectory legend read the count date, never the spend date", () => {
    // As live on 14 Nov: spend to 13 Nov, the last count 12 Nov.
    const model = structuredClone(NX_SALES_FIXTURE) as SalesDashboardModel;
    const view = model.views["venue:nx newcastle"];
    view.endDay = "2026-11-13";
    view.countDay = "2026-11-12";
    const { container } = render(<SalesDashboard model={model} surface="internal" initialShowId="venue:nx newcastle" initialPeriod="launch" />);
    expect(screen.getAllByText("to date · Internal Counts, 12 Nov").length).toBeGreaterThan(0);
    expect(screen.getAllByText("since launch, to 12 Nov").length).toBeGreaterThan(0);
    expect(screen.getByText(/^Sold, count of 12 Nov$/)).toBeTruthy();
    expect(container.textContent).not.toContain("count of 13 Nov");
    expect(container.textContent).not.toContain("Internal Counts, 13 Nov");
  });
});

describe("one date formatter on the chart", () => {
  const points: SalesChartPoint[] = ["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"].map((day, i) => ({
    day,
    estimated: false,
    count: false,
    estimateNote: null,
    values: { spend: 10 + i },
  }));

  it("pins 4 Sep on the tick labels, never Sept", () => {
    const { container } = render(<SalesChart points={points} allocation={[]} selected={["spend"]} indexRequested={false} showAllocation={false} />);
    const ticks = [...container.querySelectorAll("span.whitespace-nowrap")].map((el) => el.textContent ?? "");
    expect(ticks).toContain(`4${NBSP}Sep`);
    expect(container.textContent).not.toMatch(/Sept/);
  });

  it("the hover card writes the day the same way", () => {
    const { container } = render(
      <SalesChart points={points} allocation={[]} selected={["spend"]} indexRequested={false} showAllocation={false} pinnedDay="2026-09-04" />,
    );
    expect(container.querySelector("p.font-medium")?.textContent).toBe(`4${NBSP}Sep`);
  });
});
