import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { SupabaseClient } from "@supabase/supabase-js";

import { embeddedSeedJson } from "../analysis/cluster-seed-sql.ts";
import { seedFromKeys, type InterestReportJson, type SeedCluster, type SeedKey } from "../analysis/interest-performance.ts";
import { createDefaultDraft } from "../campaign-defaults.ts";
import { createInterestCluster, markInterestClusterUsed } from "../db/interest-clusters.ts";
import {
  addClusterToGroups,
  clustersForSourceFilter,
  effectiveClientVertical,
  findClusterForInterests,
  unresolvedLine,
  rowToInterestCluster,
  sortClusters,
  visibleClusters,
  type InterestCluster,
  type InterestClusterRow,
} from "../interest-clusters.ts";
import { buildMetaTargeting } from "../meta/adset.ts";
import type { AdSetSuggestion } from "../types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const SEED: SeedCluster[] = JSON.parse(read("docs/analysis/interest-templates-seed.json"));

function cluster(patch: Partial<InterestCluster> & Pick<InterestCluster, "id" | "name">): InterestCluster {
  return {
    vertical: "music",
    interests: [{ id: "6003902397066", name: "Electronic music (music)" }],
    evidence: null,
    source: "seed",
    unresolved: [],
    useCount: 0,
    lastUsedAt: null,
    archivedAt: null,
    createdAt: "2026-10-06T00:00:00Z",
    updatedAt: "2026-10-06T00:00:00Z",
    ...patch,
  };
}

function seededClusters(): InterestCluster[] {
  return SEED.map((s, i) =>
    cluster({ id: `seed-${i}`, name: s.name, vertical: s.vertical, interests: s.interests, evidence: s.evidence }),
  );
}

function rowBase(): InterestClusterRow {
  return {
    id: "r", name: "R", vertical: "music", interests: [{ id: "1", name: "A" }], evidence: null, source: "seed",
    use_count: 0, last_used_at: null, archived_at: null, created_at: "2026-10-06T00:00:00Z", updated_at: "2026-10-06T00:00:00Z",
  };
}

/** Minimal stand-in for the two Supabase calls createInterestCluster makes. */
function fakeSupabase(existing: InterestClusterRow[]) {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ order: async () => ({ data: existing, error: null }) }),
      }),
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          select: () => ({
            maybeSingle: async () => ({
              data: {
                id: "new",
                use_count: 0,
                last_used_at: null,
                archived_at: null,
                created_at: "2026-10-06T00:00:00Z",
                updated_at: "2026-10-06T00:00:00Z",
                ...row,
              },
              error: null,
            }),
          }),
        };
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, inserted };
}

describe("interest clusters", () => {
  it("seed migration is idempotent and embeds the seed file verbatim", () => {
    const schema = read("supabase/migrations/181_interest_clusters.sql");
    const seedSql = read("supabase/migrations/182_interest_clusters_seed.sql");
    assert.match(schema, /constraint interest_clusters_user_name_key unique \(user_id, name\)/);
    assert.match(seedSql, /on conflict \(user_id, name\) do nothing/);
    assert.match(seedSql, /'seed'/);
    assert.deepEqual(embeddedSeedJson(seedSql), SEED);
    assert.equal(new Set(SEED.map((s) => s.name)).size, SEED.length);
  });

  it("seed file regenerates from the report JSON and the seed keys", () => {
    const report: InterestReportJson = JSON.parse(read("docs/analysis/interest-performance-2026-10-06.json"));
    const keys: SeedKey[] = JSON.parse(read("docs/analysis/interest-clusters-seed-keys.json"));
    assert.deepEqual(seedFromKeys(report, keys), SEED);
    const names = SEED.map((s) => s.name);
    for (const absent of ["Techno", "Tech house", "House music"]) assert.equal(names.includes(absent), false);
    const luxury = SEED.find((s) => s.name === "Luxury")!;
    assert.equal(luxury.interestIds.includes("6003651391313"), false);
    assert.equal(luxury.evidence.note, "measured with SEAT Ibiza included");
    assert.deepEqual(luxury.evidence.dropped, [{ id: "6003651391313", name: "SEAT Ibiza", reason: "it is the car" }]);
  });

  it("pick adds the group once, with a new id and nameSource generated", () => {
    const c = cluster({ id: "c1", name: "Melodic Techno", interests: [{ id: "2", name: "Carl Cox" }, { id: "1", name: "KEINEMUSIK" }] });
    const first = addClusterToGroups([], c, "g-1");
    assert.equal(first.groups.length, 1);
    assert.deepEqual(first.added, {
      id: "g-1",
      name: "Melodic Techno",
      nameSource: "generated",
      interests: [{ id: "2", name: "Carl Cox" }, { id: "1", name: "KEINEMUSIK" }],
    });
    const second = addClusterToGroups(first.groups, c, "g-2");
    assert.equal(second.added, null);
    assert.equal(second.groups.length, 1);
  });

  it("save writes source operator and refuses an interest set already saved", async () => {
    const fresh = fakeSupabase([]);
    const saved = await createInterestCluster(fresh.client, "u1", {
      name: "My set",
      vertical: "music",
      interests: [{ id: "1", name: "A" }],
    });
    assert.equal(saved.ok, true);
    assert.equal(fresh.inserted[0].source, "operator");
    assert.equal(fresh.inserted[0].user_id, "u1");

    const existingRow: InterestClusterRow = {
      id: "seed-1",
      name: "Melodic Techno",
      vertical: "music",
      interests: [{ id: "2", name: "B" }, { id: "1", name: "A" }],
      evidence: null,
      source: "seed",
      use_count: 3,
      last_used_at: null,
      archived_at: null,
      created_at: "2026-10-06T00:00:00Z",
      updated_at: "2026-10-06T00:00:00Z",
    };
    const dup = fakeSupabase([existingRow]);
    const result = await createInterestCluster(dup.client, "u1", {
      name: "Copy",
      vertical: "music",
      interests: [{ id: "1", name: "A" }, { id: "2", name: "B" }],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.existing?.name, "Melodic Techno");
    }
    assert.equal(dup.inserted.length, 0);
    assert.equal(findClusterForInterests([rowToInterestCluster(existingRow)], [{ id: "2" }, { id: "1" }])?.id, "seed-1");
  });

  it("archive hides a cluster from the strip and from duplicate detection", () => {
    const live = cluster({ id: "a", name: "Live" });
    const archived = cluster({ id: "b", name: "Gone", archivedAt: "2026-10-06T00:00:00Z", interests: [{ id: "9", name: "Nine" }] });
    assert.deepEqual(visibleClusters([live, archived], "music").map((c) => c.id), ["a"]);
    assert.equal(findClusterForInterests([archived], [{ id: "9" }]), null);
  });

  it("vertical filter: no client reads as music; lifestyle shows on music and football clients", () => {
    const all = [
      cluster({ id: "m", name: "Music" }),
      cluster({ id: "f", name: "Football", vertical: "football" }),
      cluster({ id: "l", name: "Lifestyle", vertical: "lifestyle" }),
      cluster({ id: "o", name: "Other", vertical: "other" }),
    ];
    const ids = (v: Parameters<typeof visibleClusters>[1]) => visibleClusters(all, v).map((c) => c.id);
    assert.deepEqual(ids(null), ["m", "l"]);
    assert.deepEqual(ids("music"), ["m", "l"]);
    assert.deepEqual(ids("football"), ["f", "l"]);
    assert.deepEqual(ids("other"), ["l", "o"]);
    assert.equal(effectiveClientVertical(null), "music");
    assert.equal(effectiveClientVertical(undefined), "music");
    assert.equal(effectiveClientVertical("other"), "other");
  });

  it("POST /use increments in SQL through the RPC, never read-then-write", async () => {
    const calls: { fn: string; args: unknown }[] = [];
    const row = {
      id: "c1", name: "Deep house", vertical: "music", interests: [{ id: "1", name: "A" }], evidence: null,
      source: "seed", unresolved: [], use_count: 4, last_used_at: "2026-10-06T21:00:00Z", archived_at: null,
      created_at: "2026-10-06T00:00:00Z", updated_at: "2026-10-06T21:00:00Z",
    };
    const client = {
      rpc: (fn: string, args: unknown) => {
        calls.push({ fn, args });
        return { maybeSingle: async () => ({ data: row, error: null }) };
      },
      from: () => {
        throw new Error("markInterestClusterUsed must not touch the table directly");
      },
    } as unknown as SupabaseClient;
    const result = await markInterestClusterUsed(client, "c1");
    assert.deepEqual(calls, [{ fn: "increment_interest_cluster_use", args: { p_id: "c1" } }]);
    assert.equal(result.ok && result.value.useCount, 4);

    const schema = read("supabase/migrations/181_interest_clusters.sql");
    assert.match(schema, /create or replace function increment_interest_cluster_use\(p_id uuid\)/);
    assert.match(schema, /set use_count = use_count \+ 1,\s+last_used_at = now\(\)\s+where id = p_id\s+and user_id = auth\.uid\(\)/);
    assert.match(schema, /raise notice '181: no client with slug 4thefans — vertical not set'/);
    assert.match(schema, /'music', 'football', 'lifestyle', 'other'/);
    assert.match(schema, /'seed', 'library', 'operator'/);
  });

  it("Manage filter chips and unresolved counts", () => {
    const all = [cluster({ id: "s", name: "S" }), cluster({ id: "l", name: "L", source: "library", unresolved: ["Graff", "Bvlgari"] })];
    assert.deepEqual(clustersForSourceFilter(all, "library").map((c) => c.id), ["l"]);
    assert.equal(clustersForSourceFilter(all, "all").length, 2);
    assert.equal(unresolvedLine(all[1]), "2 names not found on Meta: Graff, Bvlgari");
    assert.equal(unresolvedLine(all[0]), null);
    assert.equal(rowToInterestCluster({ ...rowBase(), source: "library", unresolved: ["X", 3, ""] }).unresolved.join(), "X");
  });

  it("Best CPR orders by cprIndex, thin clusters after measured ones, no evidence last", () => {
    const all = [...seededClusters(), cluster({ id: "op", name: "Operator set", source: "operator" })];
    const music = sortClusters(visibleClusters(all, "music"), "best_cpr").map((c) => c.name);
    assert.deepEqual(music.slice(0, 3), ["Disc Genre", "Publications", "Electronic music"]);
    assert.deepEqual(music.slice(-6), ["Latest iPhone users", "Music festivals", "Fashion", "Luxury", "Streaming — full", "Operator set"]);
    for (const name of ["Streaming — full", "Fashion", "Luxury", "Music festivals"]) {
      assert.equal(SEED.find((s) => s.name === name)!.evidence.confidence, "thin", name);
    }
    const football = sortClusters(visibleClusters(all, "football"), "best_cpr").map((c) => c.name);
    assert.deepEqual(football, ["Football Prospecting", "Football interests", "Arsenal"]);
    const used = sortClusters(
      [cluster({ id: "x", name: "B", useCount: 2 }), cluster({ id: "y", name: "A", useCount: 2 }), cluster({ id: "z", name: "C", useCount: 5 })],
      "most_used",
    ).map((c) => c.name);
    assert.deepEqual(used, ["C", "A", "B"]);
  });

  it("a picked cluster targets exactly like a hand-built group with the same interests", () => {
    const seeded = seededClusters().find((c) => c.name === "Festival Commercial")!;
    const { added } = addClusterToGroups([], seeded, "picked");
    const handBuilt = {
      id: "hand",
      name: "Festival Commercial",
      interests: seeded.interests.map((i) => ({ id: i.id, name: i.name, source: "search" as const })),
    };
    const draft = createDefaultDraft();
    draft.audiences.interestGroups = [added!, handBuilt];
    const row = (sourceId: string): AdSetSuggestion => ({
      id: sourceId,
      name: sourceId,
      sourceType: "interest_group",
      sourceId,
      sourceName: sourceId,
      ageMin: 18,
      ageMax: 54,
      budgetPerDay: 20,
      advantagePlus: false,
      enabled: true,
    });
    const picked = buildMetaTargeting(row("picked"), draft.audiences);
    const hand = buildMetaTargeting(row("hand"), draft.audiences);
    assert.deepEqual(picked, hand);
    assert.deepEqual(picked.interests, seeded.interests);
  });
});
