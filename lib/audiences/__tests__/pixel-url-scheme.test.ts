import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeWebsitePixelUrlContains,
  stripHttpSchemeFromPixelUrlFragment,
} from "../pixel-url-contains.ts";

describe("stripHttpSchemeFromPixelUrlFragment", () => {
  it("removes https:// and http:// prefixes", () => {
    assert.equal(
      stripHttpSchemeFromPixelUrlFragment("https://wearefootballfestival.co.uk/x"),
      "wearefootballfestival.co.uk/x",
    );
    assert.equal(
      stripHttpSchemeFromPixelUrlFragment("HTTP://EXAMPLE.ORG/a"),
      "EXAMPLE.ORG/a",
    );
  });
});

describe("normalize + strip for Meta filters", () => {
  it("normalizes lines then strips schemes", () => {
    const raw =
      "https://a.com/one\nhttp://b.org/two\n/c-three";
    const parts = normalizeWebsitePixelUrlContains(raw).map(
      stripHttpSchemeFromPixelUrlFragment,
    );
    assert.deepEqual(parts, ["a.com/one", "b.org/two", "/c-three"]);
  });
});
