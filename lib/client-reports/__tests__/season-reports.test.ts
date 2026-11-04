import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SEASON_REPORT_CSP,
  SEASON_REPORT_MAX_BYTES,
  SEASON_REPORT_NOT_FOUND_BODY,
  buildSeasonReportResponse,
  clientReportVisibleToOwner,
  seasonReportStoragePath,
  storagePathBelongsToClient,
  validateSeasonReportUpload,
  visibleSeasonReports,
  type SeasonReportListItem,
} from "../access.ts";

const NOW = new Date("2026-11-04T18:00:00.000Z");
const HTML = "<!DOCTYPE html><html><body>Season</body></html>";
const SQL = readFileSync("supabase/migrations/196_client_reports.sql", "utf8");

function row(
  overrides: Partial<SeasonReportListItem> = {},
): SeasonReportListItem {
  return {
    client_id: "client-a",
    title: "Season 1",
    season: "Season 1",
    share_token: "token-a-token-a",
    enabled: true,
    expires_at: null,
    ...overrides,
  };
}

describe("season report token resolve", () => {
  it("unknown, disabled and expired are the same 404", async () => {
    const unknown = buildSeasonReportResponse(null, NOW, HTML);
    const disabled = buildSeasonReportResponse(
      { enabled: false, expires_at: null },
      NOW,
      HTML,
    );
    const expired = buildSeasonReportResponse(
      { enabled: true, expires_at: "2026-11-04T18:00:00.000Z" },
      NOW,
      HTML,
    );
    const missingFile = buildSeasonReportResponse(
      { enabled: true, expires_at: null },
      NOW,
      null,
    );

    const bodies = await Promise.all(
      [unknown, disabled, expired, missingFile].map(async (response) => {
        assert.equal(response.status, 404);
        return response.text();
      }),
    );
    assert.deepEqual(bodies, [
      SEASON_REPORT_NOT_FOUND_BODY,
      SEASON_REPORT_NOT_FOUND_BODY,
      SEASON_REPORT_NOT_FOUND_BODY,
      SEASON_REPORT_NOT_FOUND_BODY,
    ]);
  });

  it("an enabled unexpired report is 200 with a sandbox and no allow-same-origin", () => {
    const response = buildSeasonReportResponse(
      { enabled: true, expires_at: "2026-12-01T00:00:00.000Z" },
      NOW,
      HTML,
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("content-type"),
      "text/html; charset=utf-8",
    );
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.equal(csp, SEASON_REPORT_CSP);
    assert.match(csp, /sandbox/);
    assert.match(csp, /allow-scripts/);
    assert.doesNotMatch(csp, /allow-same-origin/);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });
});

describe("season report upload size", () => {
  it("rejects a file one byte over the Vercel response cap", () => {
    assert.equal(SEASON_REPORT_MAX_BYTES, Math.floor(4.5 * 1024 * 1024));
    const over = validateSeasonReportUpload({
      filename: "season-1.html",
      byteLength: SEASON_REPORT_MAX_BYTES + 1,
      head: HTML,
    });
    assert.equal(over.ok, false);
    if (!over.ok) {
      assert.equal(over.status, 413);
      assert.match(over.error, /4\.5 MB/);
      assert.match(over.error, /not saved/);
    }
    const atLimit = validateSeasonReportUpload({
      filename: "season-1.html",
      byteLength: SEASON_REPORT_MAX_BYTES,
      head: HTML,
    });
    assert.equal(atLimit.ok, true);
  });
});

describe("client_reports RLS", () => {
  it("another user cannot read a row, and the migration says the same", () => {
    const owner = "11111111-1111-1111-1111-111111111111";
    const other = "22222222-2222-2222-2222-222222222222";
    assert.equal(clientReportVisibleToOwner(owner, owner), true);
    assert.equal(clientReportVisibleToOwner(other, owner), false);
    assert.equal(clientReportVisibleToOwner(null, owner), false);

    assert.match(SQL, /enable row level security/);
    assert.match(SQL, /c\.user_id = auth\.uid\(\)/);
    assert.match(SQL, /for all/);
    assert.match(SQL, /with check/);
    assert.doesNotMatch(SQL, /on storage\.objects/i);
    assert.doesNotMatch(SQL, /alter table report_shares/i);
    assert.match(SQL, /'client-reports'/);
    assert.match(SQL, /false/);
    assert.match(SQL, new RegExp(String(SEASON_REPORT_MAX_BYTES)));
    assert.doesNotMatch(SQL, /allow-same-origin/);
  });
});

describe("portal season report list", () => {
  it("keeps only enabled, unexpired reports for that client", () => {
    const rows = [
      row(),
      row({
        share_token: "token-b-token-b",
        title: "Later",
        expires_at: "2026-12-01T00:00:00.000Z",
      }),
      row({ share_token: "token-c-token-c", enabled: false }),
      row({
        share_token: "token-d-token-d",
        expires_at: "2026-11-01T00:00:00.000Z",
      }),
      row({
        client_id: "client-b",
        share_token: "token-e-token-e",
        title: "Other client",
      }),
    ];
    const visible = visibleSeasonReports(rows, "client-a", NOW);
    assert.deepEqual(
      visible.map((item) => item.share_token),
      ["token-a-token-a", "token-b-token-b"],
    );
  });
});

describe("storage path", () => {
  it("stays under the owning client", () => {
    const clientId = "f7ed8aef-8527-4c3e-a16a-a05fc38861f5";
    const reportId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const path = seasonReportStoragePath(clientId, "Season 1", reportId);
    assert.equal(storagePathBelongsToClient(path, clientId), true);
    assert.equal(
      storagePathBelongsToClient(
        `${clientId}/Season 1/../../other/file.html`,
        clientId,
      ),
      false,
    );
    assert.equal(
      storagePathBelongsToClient(
        "00000000-0000-0000-0000-000000000000/Season 1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.html",
        clientId,
      ),
      false,
    );
  });
});

describe("public route wiring", () => {
  it("serves the document from the share prefix without a second 404 body", () => {
    const route = readFileSync("app/share/season/[token]/route.ts", "utf8");
    const portal = readFileSync("app/share/client/[token]/page.tsx", "utf8");
    const prefixes = readFileSync("lib/auth/public-routes.ts", "utf8");
    assert.match(route, /buildSeasonReportResponse/);
    assert.match(route, /storagePathBelongsToClient/);
    assert.doesNotMatch(route, /allow-same-origin/);
    assert.match(portal, /visibleSeasonReports/);
    assert.match(prefixes, /"\/share\/"/);
    assert.doesNotMatch(prefixes, /\/share\/season/);
  });
});
