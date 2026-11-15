import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseAudienceAccountIds } from "../audience-account.ts";

const routeSource = readFileSync(
  fileURLToPath(new URL("../../../app/api/meta/audience-accounts/route.ts", import.meta.url)),
  "utf8",
);

describe("POST /api/meta/audience-accounts", () => {
  it("requires a signed-in user", () => {
    const post = routeSource.slice(routeSource.indexOf("export async function POST"));
    assert.match(post, /Not signed in/);
    assert.match(post, /status: 401/);
    assert.ok(post.indexOf("Not signed in") < post.indexOf("graphMultiGetByIds"));
  });

  it("rejects more than 200 ids", () => {
    const ids = Array.from({ length: 201 }, (_, i) => String(10_000_000_000 + i));
    const parsed = parseAudienceAccountIds(ids);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.status, 400);
      assert.equal(parsed.error, "Too many audiences");
    }
    assert.match(routeSource, /parseAudienceAccountIds/);
  });

  it("keeps only ids of 10 or more digits", () => {
    const parsed = parseAudienceAccountIds([
      "120250867495400239",
      "nope",
      "123",
      " 120250867494340239 ",
      "120250867495400239",
    ]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(parsed.ids, ["120250867495400239", "120250867494340239"]);
    }
    assert.equal(parseAudienceAccountIds("120250867495400239").ok, false);
  });
});
