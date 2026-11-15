/**
 * HE1 + HE3 panels as drawn (PI1–PI6), on the Locklead and Electric
 * dry-run fixtures. Kept in this folder because vitest's include list
 * covers it.
 */

import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DirectToFanPanel } from "@/components/dashboard/audience-panels/direct-to-fan-panel";
import { WhoWeReachedPanel } from "@/components/dashboard/audience-panels/who-we-reached-panel";
import { electric, locklead } from "@/lib/dashboard/audience-panels-fixture";

afterEach(() => {
  cleanup();
});

describe("Who we reached (HE1)", () => {
  it("draws Link CTR, the totals line, and a region table with no result columns", () => {
    const { container } = render(<WhoWeReachedPanel model={locklead()} />);
    const age = container.querySelector("[data-meta-age]") as HTMLElement;
    expect(within(age).getByText("Link CTR")).toBeTruthy();
    expect(within(age).queryByText("CTR")).toBeNull();
    expect(within(age).getByText("Age unknown")).toBeTruthy();
    expect(container.querySelector("[data-totals-note]")?.textContent).toBe(
      "Meta models its split by age, so these add to 500 signups; the campaigns count 498.",
    );
    const region = container.querySelector("[data-meta-region]") as HTMLElement;
    expect([...region.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Region", "Spend", "Impr. share", "Link CTR"]);
    expect(container.textContent).toContain("Meta doesn't report signups or sales by region.");
    expect(container.textContent).toContain("TikTok reports clicks by age, not signups or sales");
    // byGender stays in the model, not on the page.
    expect(container.textContent).not.toMatch(/female|male/);
  });
});

describe("Direct-to-fan (HE3)", () => {
  it("internal: 'Rate not set' links to the client's rate field; the footnote names the bot filter", () => {
    const { container } = render(<DirectToFanPanel model={electric("internal")} />);
    const links = container.querySelectorAll("a[data-rate-not-set]");
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]!.getAttribute("href")).toBe("/clients/electric?tab=d2c");
    expect(container.textContent).toContain("Email opens are Mailchimp's bot-filtered opens: Apple Mail Privacy and link-scanner opens removed.");
    expect(container.textContent).toContain("includes 234 whole-list sends");
    expect(container.textContent).toContain("Whole list");
  });

  it("share: no 'Rate not set', no link, '—' instead", () => {
    const { container } = render(<DirectToFanPanel model={electric("share")} />);
    expect(container.textContent).not.toContain("Rate not set");
    expect(container.querySelector("[data-rate-not-set]")).toBeNull();
    expect(container.querySelector("[data-d2c-review]")).toBeNull();
  });
});
