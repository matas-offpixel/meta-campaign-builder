import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CreativePanel } from "@/components/dashboard/creative-section/creative-panel";
import { ironworksCreative } from "@/lib/dashboard/creative-section-fixture";

describe("creative panel", () => {
  it("renders the IRW0001 signup leader inside a scrolling table", () => {
    const html = renderToStaticMarkup(<CreativePanel model={ironworksCreative("share")} />);
    expect(html).toContain("JJ - Motion 9 — Streaming");
    expect(html).toContain("234");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("min-w-0");
    expect(html).toContain("Match every selected tag.");
    expect(html).not.toContain("cross-client");
    expect(html).toContain('data-surface="share"');
  });
});
