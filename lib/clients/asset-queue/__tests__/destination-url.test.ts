import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveOrganiserDestinationUrl } from "../destination-url.ts";

describe("resolveOrganiserDestinationUrl", () => {
  it("builds 4thefans organiser URL from venue city", () => {
    assert.equal(
      resolveOrganiserDestinationUrl("4thefans", "Bournemouth"),
      "https://4thefans.tv/organiser/bournemouth/",
    );
  });

  it("returns null for unknown clients", () => {
    assert.equal(resolveOrganiserDestinationUrl("other-client", "Bournemouth"), null);
  });

  it("returns null when venue city is missing", () => {
    assert.equal(resolveOrganiserDestinationUrl("4thefans", null), null);
  });
});
