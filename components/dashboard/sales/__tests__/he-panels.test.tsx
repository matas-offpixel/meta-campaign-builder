import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/dashboard/presale-panel/presale-form", () => ({
  PresaleForm: () => <div data-presale-form />,
}));

import { ObjectiveBudgetPanel } from "@/components/dashboard/objective-budget-panel/panel";
import { PresalePanel } from "@/components/dashboard/presale-panel/presale-panel";
import { dodPresale, electricBudget } from "@/lib/dashboard/he-panels/fixture";

afterEach(() => {
  cleanup();
});

describe("HE4 and HE6 panels", () => {
  it("the share presale has the counted line and no entry form", () => {
    const { container } = render(<PresalePanel model={dodPresale("share")} />);
    expect(container.textContent).toContain("Signups at presale · to Tue 8 Sep");
    expect(container.textContent).toContain("counted · CIRQLIN");
    expect(container.textContent).toContain("Signup spend");
    expect(container.textContent).toContain("Meta signup spend");
    expect(container.textContent).not.toContain("Add the window figures");
    expect(container.textContent).not.toContain("Community at presale");
    expect(container.querySelector("[data-presale-form]")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
  });

  it("the internal presale draws the form", () => {
    const { container } = render(<PresalePanel model={dodPresale("internal")} />);
    expect(container.querySelector("[data-presale-form]")).toBeTruthy();
    expect(container.querySelector("a[href='#presale-form']")?.textContent).toBe("Add the window figures");
  });

  it("the client budget names an unstored objective and excludes WhatsApp from the total", () => {
    const { container } = render(<ObjectiveBudgetPanel model={electricBudget()} />);
    expect(container.textContent).toContain("Objective not stored");
    expect(container.textContent).toContain("£ / signup");
    expect(container.textContent).toContain("The total excludes WhatsApp.");
    expect(container.textContent).toContain("£43,431.26");
    expect(container.textContent).not.toContain("paid − credits");
  });
});
