import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { keepCounts } from "@/components/campaign-tree/keep-counts";

afterEach(() => cleanup());

function counts(text: string): string[] {
  const { container } = render(<p>{keepCounts(text)}</p>);
  expect(container.textContent).toBe(text);
  return [...container.querySelectorAll("[data-count]")].map((n) => {
    expect(n.className).toContain("whitespace-nowrap");
    return n.textContent ?? "";
  });
}

describe("keepCounts (design #1364: a count never breaks from its unit)", () => {
  it("keeps '{n} ad sets' and '1 ad set' together", () => {
    expect(counts("live · 18 ad sets")).toEqual(["18 ad sets"]);
    expect(counts("paused · 1 ad set")).toEqual(["1 ad set"]);
  });

  it("keeps '{n} of {m} ad sets' and '{n} of 1 ad set' together", () => {
    expect(counts("6 of 6 ad sets")).toEqual(["6 of 6 ad sets"]);
    expect(counts("0 of 1 ad set · paused")).toEqual(["0 of 1 ad set"]);
  });

  it("wraps each count in an additions line, leaves other words alone", () => {
    expect(counts("Thu 26 Nov · to 18 ad sets · Matas")).toEqual(["18 ad sets"]);
    expect(counts("paused")).toEqual([]);
  });
});
