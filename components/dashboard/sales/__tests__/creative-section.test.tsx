import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CreativePanel } from "@/components/dashboard/creative-section/creative-panel";
import { cdwCreative, cdwWithLinks } from "@/lib/dashboard/creative-section-fixture";

describe("creative panel", () => {
  it("stacks the signup leader and draws the format cost", () => {
    const html = renderToStaticMarkup(<CreativePanel model={cdwCreative("internal")} />);
    expect(html).toContain("UGC 2 - CDW – Copy");
    expect(html).toContain("2,912 signups · £0.63 each · £1,827.94");
    expect(html).toContain("sm:hidden");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("min-w-0");
    expect(html).toContain("£0.76");
    expect(html).not.toContain("creative_scores");
    expect(html).toContain("IRONWORKS · Charlotte de Witte · Meta and TikTok · to 6 Aug");
    expect(html).toContain("View ad");
  });

  it("renders a share view with figures and none of the internal links", () => {
    const html = renderToStaticMarkup(<CreativePanel model={cdwWithLinks("share")} />);
    expect(html).toContain('data-surface="share"');
    expect(html).toContain("2,912");
    expect(html).toContain("UGC edit");
    expect(html).not.toContain("View ad");
    expect(html).not.toContain("adsmanager");
    expect(html).not.toContain("#render-");
    expect(html).not.toContain("refresh-line");
    expect(html).not.toContain("drive.google.com");
    expect(html).not.toContain(">Lab<");
    expect(html).not.toContain("cross-client");
  });
});
