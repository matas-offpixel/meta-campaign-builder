import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { unionAudiencePageSources } from "../page-source-union.ts";

// Fixture from the Columbo Group incident this PR fixes: Mungo's Hi Fi
// (page_id 158498877502759) is a page shared into Columbo Group's BM
// (527693220707294) by a different Business Manager (Scotch Bonnet Records
// Ltd, is_owned_by_bm = false), with Matas holding Partial (Ads) access.
// `bm_pages` (BM Asset Sync tool) correctly records `user_has_access = true`
// for it, but Meta's live `/me/accounts` query — which the audience source
// picker used to rely on exclusively — omits it.
const MUNGOS_BM_PAGE = {
  page_id: "158498877502759",
  page_name: "Mungo's Hi Fi",
  category: "Musician/band",
};

describe("unionAudiencePageSources", () => {
  it("includes a bm_pages fixture even when the Meta live query returns 0 pages", () => {
    const merged = unionAudiencePageSources([], [MUNGOS_BM_PAGE], []);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.id, "158498877502759");
    assert.equal(merged[0]?.name, "Mungo's Hi Fi");
    assert.equal(merged[0]?.source, "bm-shared");
  });

  it("dedupes by page id, preferring the live Meta result over bm_pages/default list", () => {
    const merged = unionAudiencePageSources(
      [{ id: "158498877502759", name: "Mungo's Hi Fi (Meta)" }],
      [MUNGOS_BM_PAGE],
      [{ id: "158498877502759", name: "Mungo's Hi Fi (default list)" }],
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.name, "Mungo's Hi Fi (Meta)");
    assert.equal(merged[0]?.source, undefined);
  });

  it("merges all three sources in priority order when ids don't overlap", () => {
    const merged = unionAudiencePageSources(
      [{ id: "live-1", name: "Live Page" }],
      [MUNGOS_BM_PAGE],
      [{ id: "527691180707498", name: "Default List Page" }],
    );
    assert.deepEqual(merged.map((p) => p.id), [
      "live-1",
      "158498877502759",
      "527691180707498",
    ]);
  });

  it("falls back to page id as the name when bm_pages/default list have no name", () => {
    const merged = unionAudiencePageSources(
      [],
      [{ page_id: "111", page_name: null }],
      [{ id: "222" }],
    );
    assert.equal(merged[0]?.name, "111");
    assert.equal(merged[1]?.name, "222");
  });

  it("skips falsy ids defensively", () => {
    const merged = unionAudiencePageSources(
      [{ id: "", name: "no id" }],
      [{ page_id: "", page_name: "no id" }],
      [{ id: "", name: "no id" }],
    );
    assert.equal(merged.length, 0);
  });
});

describe("pages source route wiring", () => {
  it("unions the Meta live query with bm_pages + default_page_ids backfill", () => {
    const route = readFileSync("app/api/audiences/sources/pages/route.ts", "utf8");
    assert.match(route, /unionAudiencePageSources/);
    assert.match(route, /getBMPagesWithUserAccess/);
    assert.match(route, /fetchPagesByIds/);
    assert.match(route, /metaBusinessId/);
    assert.match(route, /defaultPageIds/);
  });

  it("reads bm_pages via the service-role client, not the cookie-bound one", () => {
    const route = readFileSync("app/api/audiences/sources/pages/route.ts", "utf8");
    assert.match(route, /createServiceRoleClient/);
  });
});
