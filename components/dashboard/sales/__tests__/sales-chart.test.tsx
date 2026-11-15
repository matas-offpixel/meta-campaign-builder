/** The sales chart breaks a line on an empty day (design, D13c, 14 Nov): one polyline per run, no bridge, no £0. */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SalesChart } from "@/components/dashboard/sales/sales-chart";
import type { SalesChartPoint } from "@/lib/dashboard/sales-vs-spend";

afterEach(() => {
  cleanup();
});

const day = (n: number) => `2026-11-${String(n).padStart(2, "0")}`;

function points(values: (number | null)[]): SalesChartPoint[] {
  return values.map((value, i) => ({ day: day(i + 1), estimated: false, count: false, estimateNote: null, values: { costPerRegistration: value } }));
}

function lines(values: (number | null)[]) {
  const { container } = render(<SalesChart points={points(values)} allocation={[]} selected={["costPerRegistration"]} indexRequested={false} showAllocation={false} />);
  return [...container.querySelectorAll("polyline")].map((el) => (el.getAttribute("points") ?? "").split(" ").filter(Boolean));
}

describe("SalesChart empty days", () => {
  it("nulls at the start, in the middle and at the end break the line into separate runs", () => {
    const runs = lines([null, 2, 3, null, null, 4, 5, 6, null]);
    expect(runs.map((r) => r.length)).toEqual([2, 3]);
  });

  it("never draws an empty day as 0: no point sits on the zero line", () => {
    const runs = lines([null, 2, null, 4, 4]);
    const zeroY = runs.flat().map((p) => Number(p.split(",")[1]));
    const max = Math.max(...zeroY);
    // Every drawn point is a real value (2 or 4), so none sits at the plot's bottom (value 0).
    expect(new Set(zeroY).size).toBeGreaterThan(1);
    expect(runs.flat().length).toBe(4);
    expect(max).toBeLessThan(1000 - 28);
  });

  it("a lone day between empty days still shows, as a dot", () => {
    const { container } = render(<SalesChart points={points([null, 3, null])} allocation={[]} selected={["costPerRegistration"]} indexRequested={false} showAllocation={false} />);
    const only = container.querySelector("polyline")!;
    expect(only.getAttribute("stroke-linecap")).toBe("round");
  });

  it("a series with no empty day is one polyline, as before", () => {
    expect(lines([1, 2, 3, 4]).length).toBe(1);
  });
});
