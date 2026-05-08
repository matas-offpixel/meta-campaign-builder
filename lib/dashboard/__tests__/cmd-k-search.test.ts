import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  highlightMatch,
  searchCmdKIndex,
  type CmdKSearchIndex,
} from "../cmd-k-search.ts";

const root = path.resolve(import.meta.dirname ?? __dirname, "../../..");

const index: CmdKSearchIndex = {
  clients: [
    {
      kind: "client",
      id: "client-4tf",
      name: "4theFans",
      slug: "4thefans",
      type: "retainer",
      href: "/clients/client-4tf/dashboard",
    },
  ],
  events: [
    {
      kind: "event",
      id: "event-lock",
      name: "Champions League Final - Lock Warehouse",
      slug: "cl-final-lock",
      event_code: "4TF26-ARSENAL-CL-FL",
      venue_name: "Lock Warehouse",
      venue_city: "London",
      client_id: "client-4tf",
      client_name: "4theFans",
      event_date: "2026-05-31",
      status: "active",
      href: "/events/event-lock",
    },
    {
      kind: "event",
      id: "event-manc",
      name: "England v Croatia",
      slug: "england-croatia",
      event_code: "WC26-MANCHESTER",
      venue_name: "Depot Mayfield",
      venue_city: "Manchester",
      client_id: "client-4tf",
      client_name: "4theFans",
      event_date: "2026-06-12",
      status: "active",
      href: "/events/event-manc",
    },
  ],
};

describe("cmd-k search", () => {
  it("matches event venue text", () => {
    const results = searchCmdKIndex(index, "lock");
    assert.equal(results[0]?.item.id, "event-lock");
  });

  it("matches event codes and client text", () => {
    const results = searchCmdKIndex(index, "4TF");
    assert.ok(results.some((result) => result.item.id === "client-4tf"));
    assert.ok(results.some((result) => result.item.id === "event-lock"));
  });

  it("matches city tokens", () => {
    const results = searchCmdKIndex(index, "manc");
    assert.equal(results[0]?.item.id, "event-manc");
  });

  it("highlights exact substring matches", () => {
    assert.deepEqual(highlightMatch("Lock Warehouse", "lock"), [
      { text: "Lock", match: true },
      { text: " Warehouse", match: false },
    ]);
  });

  it("search-index route uses user-scoped Supabase and private cache", () => {
    const src = fs.readFileSync(
      path.join(root, "app/api/internal/search-index/route.ts"),
      "utf8",
    );
    assert.ok(
      src.includes('from "@/lib/supabase/server"'),
      "route should use the cookie-bound server Supabase client",
    );
    assert.ok(
      !src.includes("createServiceRoleClient"),
      "search index must not use service-role reads",
    );
    assert.ok(
      src.includes('"Cache-Control": "private, max-age=300"'),
      "route should return a private 5-minute cache header",
    );
  });
});
