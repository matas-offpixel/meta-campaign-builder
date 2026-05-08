import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConceptGroupRow } from "../../reporting/group-creatives.ts";
import {
  buildMetaThumbnailProxyUrl,
  resolveProxiedRepresentativeThumbnail,
} from "../meta-thumbnail-proxy-url.ts";

describe("meta-thumbnail-proxy-url", () => {
  it("builds session proxy URL", () => {
    const u = buildMetaThumbnailProxyUrl("123", {
      kind: "session",
      clientId: "cid",
    });
    assert.ok(u?.includes("/api/proxy/creative-thumbnail?"));
    assert.ok(u?.includes("ad_id=123"));
    assert.ok(u?.includes("client_id=cid"));
  });

  it("builds share proxy URL with event_code", () => {
    const u = buildMetaThumbnailProxyUrl("456", {
      kind: "share",
      shareToken: "tok",
      eventCode: "WC26-X",
    });
    assert.ok(u?.includes("share_token=tok"));
    assert.ok(u?.includes("event_code="));
  });

  it("resolveProxiedRepresentativeThumbnail prefers proxy when ad id present", () => {
    const group = {
      representative_thumbnail_ad_id: "999",
      representative_thumbnail: "https://dead.example/old.jpg",
    } as ConceptGroupRow;
    const out = resolveProxiedRepresentativeThumbnail(group, {
      kind: "session",
      clientId: "c",
    });
    assert.ok(out?.startsWith("/api/proxy/creative-thumbnail"));
  });
});
