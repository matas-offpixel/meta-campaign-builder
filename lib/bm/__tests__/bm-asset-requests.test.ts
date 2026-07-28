/**
 * lib/bm/__tests__/bm-asset-requests.test.ts
 *
 * Regression guards for BM Asset Sync v2 (ad accounts, pixels, IG accounts).
 *
 * Every expectation here is pinned to a response captured LIVE from Graph API
 * v23.0 on 2026-07-28 using the operator's own token — the JSON files in
 * `./fixtures/` are verbatim API output (only opaque `paging` cursors and human
 * names removed). They are NOT hand-written fixtures, which matters because
 * three of the four assumptions the original brief made about this API were
 * wrong, and docs-derived fixtures would have encoded the same mistakes:
 *
 *   1. `client_instagram_accounts` does not exist (real: `client_instagram_assets`)
 *   2. pixels have no MANAGE task
 *   3. IG uses CONTENT/FULL_CONTROL, not CREATE_CONTENT/MANAGE_ACCESS
 *
 * Plus one finding that only shows up at runtime: Meta EXPANDS grants, so
 * verification must be a superset check (see the ig_asset fixture, where a
 * single requested ADVERTISE reads back as five tasks).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  areTasksValidForKind,
  BM_ASSET_DESCRIPTORS,
  BM_V2_ASSET_KINDS,
  describeAssetKind,
  grantSatisfied,
  isBMAssetKind,
  KIND_BY_SLUG,
  SLUG_BY_KIND,
  tasksForRole,
  type BMAssetKind,
} from "../asset-kinds.ts";
import {
  buildAssetGrantRequest,
  buildAssetListRequest,
  extractUserTasks,
} from "../../meta/business-manager-asset-requests.ts";

const BIZ_ID = "741799859254067"; // LWE Business Manager
const OFF_PIXEL_BIZ = "944651277948334"; // Off / Pixel Business Manager
const TARGET_USER_ID = "1572520317622050"; // business-scoped id, LWE

function fixture(name: string): Record<string, unknown> {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Record<string, unknown>;
}

// ─── Grant request shape ─────────────────────────────────────────────────────

describe("buildAssetGrantRequest — one verified body shape for all asset types", () => {
  it("byte-diffs POST /{assetId}/assigned_users for an ad account", () => {
    const req = buildAssetGrantRequest(
      "ad_account",
      "act_932846012721428",
      OFF_PIXEL_BIZ,
      TARGET_USER_ID,
      "ADVERTISER",
    );
    assert.equal(req.path, "/act_932846012721428/assigned_users");
    assert.deepEqual(req.body, {
      business: OFF_PIXEL_BIZ,
      user: TARGET_USER_ID,
      tasks: ["ADVERTISE"],
    });
  });

  it("addresses the act_-prefixed node id, never the bare account_id", () => {
    const req = buildAssetGrantRequest(
      "ad_account",
      "act_932846012721428",
      OFF_PIXEL_BIZ,
      TARGET_USER_ID,
      "ADVERTISER",
    );
    assert.ok(
      req.path.startsWith("/act_"),
      "ad-account grants must address the act_-prefixed node id",
    );
  });

  it("byte-diffs the pixel grant body", () => {
    const req = buildAssetGrantRequest(
      "pixel",
      "1475359374117271",
      OFF_PIXEL_BIZ,
      TARGET_USER_ID,
      "ADVERTISER",
    );
    assert.equal(req.path, "/1475359374117271/assigned_users");
    assert.deepEqual(req.body, {
      business: OFF_PIXEL_BIZ,
      user: TARGET_USER_ID,
      tasks: ["ADVERTISE"],
    });
  });

  it("byte-diffs the IG grant body and addresses the BUSINESS ASSET id, not ig_user_id", () => {
    // 1026165617251103 is the business asset id; 17841447022816929 is the
    // ig_user_id for the same account. Grants against the latter fail.
    const req = buildAssetGrantRequest(
      "ig_account",
      "1026165617251103",
      OFF_PIXEL_BIZ,
      TARGET_USER_ID,
      "ADVERTISER",
    );
    assert.equal(req.path, "/1026165617251103/assigned_users");
    assert.ok(
      !req.path.includes("17841447022816929"),
      "must not address the ig_user_id — grants require the business asset id",
    );
    assert.deepEqual(req.body, {
      business: OFF_PIXEL_BIZ,
      user: TARGET_USER_ID,
      tasks: ["ADVERTISE"],
    });
  });

  it("always includes `business` in the body, for every kind and role", () => {
    for (const kind of BM_V2_ASSET_KINDS) {
      for (const role of ["ADVERTISER", "ANALYST", "EDITOR", "ADMIN"] as const) {
        const req = buildAssetGrantRequest(kind, "123", BIZ_ID, TARGET_USER_ID, role);
        assert.equal(req.body.business, BIZ_ID, `${kind}/${role} lost the business field`);
        assert.ok(req.body.tasks.length > 0, `${kind}/${role} produced no tasks`);
      }
    }
  });

  it("keeps tasks a structured array — it must be posted as JSON, not form-encoded", () => {
    // Verified live: under form encoding, a JSON-stringified tasks array is
    // rejected by the IG edge with code 100 "Failed to parse the request body
    // parameters", while the JSON body succeeds. If tasks ever becomes a
    // pre-serialised string here, that's the bug reappearing.
    const req = buildAssetGrantRequest(
      "ig_account",
      "1026165617251103",
      OFF_PIXEL_BIZ,
      TARGET_USER_ID,
      "ADVERTISER",
    );
    assert.ok(Array.isArray(req.body.tasks), "tasks must stay a real array");
  });
});

// ─── Task enums ──────────────────────────────────────────────────────────────

describe("task enums — verified per asset type, no cross-type assumptions", () => {
  it("ADVERTISE is the one task valid on all four kinds (why it's the default role)", () => {
    for (const kind of Object.keys(BM_ASSET_DESCRIPTORS) as BMAssetKind[]) {
      assert.ok(
        BM_ASSET_DESCRIPTORS[kind].permittedTasks.includes("ADVERTISE"),
        `${kind} unexpectedly lacks ADVERTISE`,
      );
      assert.deepEqual(tasksForRole(kind, "ADVERTISER"), ["ADVERTISE"]);
    }
  });

  it("pixels have NO MANAGE task — the brief assumed they did", () => {
    assert.ok(!BM_ASSET_DESCRIPTORS.pixel.permittedTasks.includes("MANAGE"));
    assert.ok(
      !areTasksValidForKind("pixel", ["MANAGE"]),
      "MANAGE on a pixel must be rejected before we ever call Meta",
    );
    // ADMIN degrades to the strongest task pixels actually permit.
    assert.deepEqual(tasksForRole("pixel", "ADMIN"), ["EDIT"]);
  });

  it("IG uses CONTENT/FULL_CONTROL, not the page vocabulary the brief assumed", () => {
    const ig = BM_ASSET_DESCRIPTORS.ig_account.permittedTasks;
    assert.ok(ig.includes("CONTENT"));
    assert.ok(ig.includes("FULL_CONTROL"));
    assert.ok(!ig.includes("CREATE_CONTENT"), "CREATE_CONTENT is page-only");
    assert.ok(!ig.includes("MANAGE_ACCESS"), "MANAGE_ACCESS is not a real IG task");
    assert.ok(!ig.includes("MANAGE"), "MANAGE is not a real IG task");
    assert.deepEqual(tasksForRole("ig_account", "EDITOR"), ["CONTENT"]);
    assert.deepEqual(tasksForRole("ig_account", "ADMIN"), ["FULL_CONTROL"]);
  });

  it("rejects a task borrowed from another asset type", () => {
    assert.ok(!areTasksValidForKind("ad_account", ["CONTENT"]), "CONTENT is IG-only");
    assert.ok(!areTasksValidForKind("ig_account", ["UPLOAD"]), "UPLOAD is pixel-only");
    assert.ok(!areTasksValidForKind("pixel", ["DRAFT"]), "DRAFT is ad-account-only");
    assert.ok(!areTasksValidForKind("ad_account", []), "empty task list is never valid");
  });

  it("every role maps to tasks Meta actually permits for that kind", () => {
    for (const kind of Object.keys(BM_ASSET_DESCRIPTORS) as BMAssetKind[]) {
      for (const role of ["ADVERTISER", "ANALYST", "EDITOR", "ADMIN"] as const) {
        assert.ok(
          areTasksValidForKind(kind, tasksForRole(kind, role)),
          `${kind}/${role} maps to a task Meta would reject`,
        );
      }
    }
  });

  it("matches the permitted_tasks Meta returned live for ad accounts and pixels", () => {
    const adAccount = fixture("assigned_users_ad_account.json");
    const adRows = adAccount.data as { permitted_tasks?: string[] }[];
    assert.deepEqual(
      [...(adRows[0].permitted_tasks ?? [])].sort(),
      [...BM_ASSET_DESCRIPTORS.ad_account.permittedTasks].sort(),
      "ad-account enum drifted from the live permitted_tasks capture",
    );

    const pixel = fixture("assigned_users_pixel.json");
    const pixelRows = pixel.data as { permitted_tasks?: string[] }[];
    assert.deepEqual(
      [...(pixelRows[0].permitted_tasks ?? [])].sort(),
      [...BM_ASSET_DESCRIPTORS.pixel.permittedTasks].sort(),
      "pixel enum drifted from the live permitted_tasks capture",
    );
  });

  it("IG assets expose no permitted_tasks field at all — enum came from observation", () => {
    const ig = fixture("assigned_users_ig_asset.json");
    const rows = ig.data as { permitted_tasks?: string[] }[];
    assert.ok(rows.length > 0, "fixture should carry at least one assignment");
    for (const row of rows) {
      assert.equal(
        row.permitted_tasks,
        undefined,
        "IG unexpectedly started returning permitted_tasks — revisit the derived enum",
      );
    }
    assert.equal(BM_ASSET_DESCRIPTORS.ig_account.exposesPermittedTasks, false);
    assert.equal(BM_ASSET_DESCRIPTORS.ad_account.exposesPermittedTasks, true);
  });
});

// ─── Grant verification must be a superset check ─────────────────────────────

describe("grantSatisfied — superset, never equality (Meta expands grants)", () => {
  it("treats the live IG read-back of a single ADVERTISE grant as satisfied", () => {
    const ig = fixture("assigned_users_ig_asset.json");
    const rows = ig.data as { id: string; tasks?: string[] }[];
    const actual = rows[0].tasks ?? [];

    // Live capture: we requested exactly ["ADVERTISE"] and Meta stored five tasks.
    assert.deepEqual(actual, [
      "ADVERTISE",
      "ANALYZE",
      "CONTENT",
      "MESSAGES",
      "COMMUNITY_ACTIVITY",
    ]);
    assert.ok(actual.length > 1, "this is the expansion the superset check exists for");
    assert.ok(grantSatisfied(["ADVERTISE"], actual));
    assert.notDeepEqual(
      ["ADVERTISE"],
      actual,
      "an equality check would call this successful grant a failure",
    );
  });

  it("reports an unsatisfied grant when the requested task is absent", () => {
    assert.ok(!grantSatisfied(["MANAGE"], ["ADVERTISE", "ANALYZE"]));
    assert.ok(!grantSatisfied(["ADVERTISE"], []));
    assert.ok(!grantSatisfied([], ["ADVERTISE"]), "an empty request is never satisfied");
  });
});

// ─── List request shape + parsing real payloads ──────────────────────────────

describe("buildAssetListRequest — verified edge names + inline assigned_users", () => {
  it("uses owned_/client_instagram_ASSETS — client_instagram_accounts does not exist", () => {
    const owned = buildAssetListRequest("ig_account", BIZ_ID, "owned");
    const client = buildAssetListRequest("ig_account", BIZ_ID, "client");
    assert.equal(owned.path, `/${BIZ_ID}/owned_instagram_assets`);
    assert.equal(client.path, `/${BIZ_ID}/client_instagram_assets`);
    assert.ok(
      !client.path.includes("client_instagram_accounts"),
      "client_instagram_accounts 400s with code 100 — it is not a real edge",
    );
  });

  it("builds the owned/client edge pair for every kind", () => {
    const expected: Record<BMAssetKind, [string, string]> = {
      page: ["owned_pages", "client_pages"],
      ad_account: ["owned_ad_accounts", "client_ad_accounts"],
      pixel: ["owned_pixels", "client_pixels"],
      ig_account: ["owned_instagram_assets", "client_instagram_assets"],
    };
    for (const kind of Object.keys(expected) as BMAssetKind[]) {
      const [ownedEdge, clientEdge] = expected[kind];
      assert.equal(buildAssetListRequest(kind, BIZ_ID, "owned").path, `/${BIZ_ID}/${ownedEdge}`);
      assert.equal(buildAssetListRequest(kind, BIZ_ID, "client").path, `/${BIZ_ID}/${clientEdge}`);
    }
  });

  it("nests the required business argument inside the assigned_users expansion", () => {
    // Verified live: `fields=...,assigned_users{id,tasks}` fails outright with
    // code 100 "The parameter business is required" — Meta rejects the whole
    // request rather than omitting the field. The argument must be nested.
    const req = buildAssetListRequest("pixel", BIZ_ID, "owned");
    assert.ok(
      req.params.fields.includes(`assigned_users.business(${BIZ_ID}){id,tasks}`),
      "assigned_users expansion must carry .business(<bizId>)",
    );
    assert.ok(
      !/assigned_users\{/.test(req.params.fields),
      "a bare assigned_users{...} expansion is rejected by Meta",
    );
  });

  it("byte-diffs the full ad-account list field string", () => {
    const req = buildAssetListRequest("ad_account", BIZ_ID, "owned");
    assert.equal(
      req.params.fields,
      "id,account_id,name,account_status,currency,timezone_name,disable_reason," +
        `assigned_users.business(${BIZ_ID}){id,tasks}`,
    );
  });
});

describe("extractUserTasks — against verbatim live list payloads", () => {
  it("reads the operator's tasks from a real owned_ad_accounts row", () => {
    const payload = fixture("list_owned_ad_accounts.json");
    const rows = payload.data as {
      id: string;
      assigned_users?: { data?: { id: string; tasks?: string[] }[] };
    }[];
    const row = rows.find((r) => r.assigned_users?.data?.some((u) => u.id === TARGET_USER_ID));
    assert.ok(row, "fixture should contain a row assigned to the operator");
    const tasks = extractUserTasks(row, TARGET_USER_ID);
    assert.ok(tasks.length > 0, "operator tasks should be non-empty");
    assert.ok(tasks.includes("ADVERTISE"));
  });

  it("returns [] when assigned_users is absent entirely, not just empty", () => {
    // Meta OMITS the assigned_users key for assets with zero assignments —
    // verified on LWE's owned_instagram_assets, where only some rows carry it.
    const payload = fixture("list_owned_instagram_assets.json");
    const rows = payload.data as {
      id: string;
      assigned_users?: { data?: { id: string; tasks?: string[] }[] };
    }[];
    const bare = rows.find((r) => r.assigned_users === undefined);
    assert.ok(bare, "fixture should contain a row with no assigned_users key");
    assert.deepEqual(extractUserTasks(bare, TARGET_USER_ID), []);
  });

  it("returns [] for a different user's assignment rather than leaking it", () => {
    const payload = fixture("list_client_pixels.json");
    const rows = payload.data as {
      id: string;
      assigned_users?: { data?: { id: string; tasks?: string[] }[] };
    }[];
    const assigned = rows.find((r) => (r.assigned_users?.data?.length ?? 0) > 0);
    assert.ok(assigned, "fixture should contain an assigned pixel");
    assert.deepEqual(
      extractUserTasks(assigned, "999999999999999"),
      [],
      "must not report another user's tasks as the operator's",
    );
  });

  it("every fixture row exposes the id the grant builder needs", () => {
    for (const [name, idKey] of [
      ["list_owned_ad_accounts.json", "id"],
      ["list_client_pixels.json", "id"],
      ["list_owned_instagram_assets.json", "id"],
    ] as const) {
      const rows = fixture(name).data as Record<string, unknown>[];
      assert.ok(rows.length > 0, `${name} should not be empty`);
      for (const row of rows) {
        assert.equal(typeof row[idKey], "string", `${name} row missing ${idKey}`);
      }
    }
  });

  it("IG rows carry ig_user_id separately from the grantable asset id", () => {
    const rows = fixture("list_owned_instagram_assets.json").data as {
      id: string;
      ig_user_id?: string;
    }[];
    const withUser = rows.filter((r) => r.ig_user_id);
    assert.ok(withUser.length > 0, "fixture should carry ig_user_id");
    for (const row of withUser) {
      assert.notEqual(
        row.id,
        row.ig_user_id,
        "asset id and ig_user_id must stay distinct — conflating them breaks grants",
      );
    }
  });
});

// ─── Kind plumbing ───────────────────────────────────────────────────────────

describe("asset kind plumbing", () => {
  it("round-trips every kind through its URL slug", () => {
    for (const kind of Object.keys(SLUG_BY_KIND) as BMAssetKind[]) {
      assert.equal(KIND_BY_SLUG[SLUG_BY_KIND[kind]], kind);
    }
  });

  it("rejects unknown kinds", () => {
    assert.ok(isBMAssetKind("ad_account"));
    assert.ok(!isBMAssetKind("ad-accounts"), "slugs are not kinds");
    assert.ok(!isBMAssetKind("instagram"));
  });

  it("gives every kind a distinct table and id column", () => {
    const tables = new Set<string>();
    for (const kind of Object.keys(BM_ASSET_DESCRIPTORS) as BMAssetKind[]) {
      const d = describeAssetKind(kind);
      assert.ok(d.table.startsWith("bm_"), `${kind} table should be bm_-prefixed`);
      assert.ok(!tables.has(d.table), `${kind} reuses table ${d.table}`);
      tables.add(d.table);
      assert.ok(d.idColumn.length > 0);
      assert.ok(d.listFields.length > 0);
    }
    assert.equal(tables.size, 4);
  });
});
