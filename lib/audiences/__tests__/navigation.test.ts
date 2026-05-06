import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Audience Builder navigation", () => {
  it("promotes Audience Builder and keeps Audience Seeds label", () => {
    const nav = readFileSync("components/dashboard/dashboard-nav.tsx", "utf8");
    const landing = readFileSync("app/(dashboard)/audience-builder/page.tsx", "utf8");
    assert.match(nav, /label: "Audience Builder"/);
    assert.match(nav, /href: "\/audience-builder"/);
    assert.match(nav, /label: "Audience Seeds"/);
    assert.match(nav, /href: "\/audiences"/);
    assert.match(landing, /AudienceBuilderClientPicker/);
  });
});
