import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filterPagesByQuery } from "../filter-pages-by-query.ts";

describe("filterPagesByQuery", () => {
  const pages = [
    { id: "1", name: "Arsenal FC Official", slug: "arsenal" },
    { id: "2", name: "Other Page", slug: "chelsea" },
    { id: "3", name: "4theFans", slug: "four-the-fans" },
  ];

  it("filters by substring of page name (case-insensitive)", () => {
    const out = filterPagesByQuery(pages, "arsenal");
    assert.equal(out.length, 1);
    assert.equal(out[0]?.id, "1");
  });

  it("filters by slug match", () => {
    const out = filterPagesByQuery(pages, "four-the");
    assert.equal(out.length, 1);
    assert.equal(out[0]?.id, "3");
  });
});
