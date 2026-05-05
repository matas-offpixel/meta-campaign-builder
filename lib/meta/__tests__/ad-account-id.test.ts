import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  withActPrefix,
  withoutActPrefix,
} from "../ad-account-id.ts";

describe("withActPrefix", () => {
  it("prefixes bare numeric ids", () => {
    assert.equal(withActPrefix("10151014958791885"), "act_10151014958791885");
    assert.equal(withActPrefix("210578427"), "act_210578427");
  });

  it("is idempotent when already prefixed", () => {
    assert.equal(
      withActPrefix("act_10151014958791885"),
      "act_10151014958791885",
    );
  });

  it("returns empty string unchanged", () => {
    assert.equal(withActPrefix(""), "");
  });
});

describe("withoutActPrefix", () => {
  it("strips act_ once", () => {
    assert.equal(withoutActPrefix("act_123"), "123");
  });

  it("leaves bare ids unchanged", () => {
    assert.equal(withoutActPrefix("10151014958791885"), "10151014958791885");
  });

  it("is idempotent on bare digits", () => {
    assert.equal(withoutActPrefix("123"), "123");
  });
});
