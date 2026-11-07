import assert from "node:assert/strict";
import { readFileSync as readFile } from "node:fs";
import { describe, it } from "node:test";

import { addClusterFromInsights, isClusterAdded, readAddedClusters, seedAddedClusters } from "../../../components/insights-rail/add-cluster.ts";

/**
 * "Add cluster" (IR5): one click adds the cluster to the draft and counts
 * the pick once; a second click on the same cluster does neither. The
 * builder's chip reads the same store.
 */
describe("Add cluster from Insights", () => {
  it("adds once and counts once", async () => {
    seedAddedClusters([]);
    const counted: string[] = [];
    const post = async (id: string) => {
      counted.push(id);
      return true;
    };
    const disc = { id: "disc", name: "Disc Genre", interests: [{ id: "1", name: "Disco" }] };
    const first = await addClusterFromInsights(disc, post, () => "2026-11-07T12:00:00.000Z");
    assert.deepEqual(first, { added: true, counted: true });
    assert.deepEqual(readAddedClusters(), [{ id: "disc", name: "Disc Genre", interests: [{ id: "1", name: "Disco" }], addedAt: "2026-11-07T12:00:00.000Z" }]);
    assert.equal(isClusterAdded("disc"), true);
    const again = await addClusterFromInsights(disc, post);
    assert.deepEqual(again, { added: false, counted: false });
    assert.deepEqual(counted, ["disc"]);
    assert.equal(readAddedClusters().length, 1);
    const festivals = await addClusterFromInsights({ id: "fest", name: "Music festivals", interests: [] }, async () => false);
    assert.deepEqual(festivals, { added: true, counted: false });
    assert.deepEqual(readAddedClusters().map((row) => row.name), ["Disc Genre", "Music festivals"]);
    seedAddedClusters([]);
  });

  it("the builder marks an added cluster with the chip, and the frame mount seeds the store", () => {
    const chip = readFileSync("components/insights-rail/added-clusters.tsx");
    assert.match(chip, /added from Insights/);
    assert.match(chip, /data-added-from-insights/);
    assert.match(chip, /useAddedClusters\(\)/);
    assert.match(readFileSync("components/insights-rail/use-added-clusters.ts"), /useSyncExternalStore\(addedClustersStore\.subscribe/);
    const rail = readFileSync("components/insights-rail/insights-rail.tsx");
    assert.match(rail, /addClusterFromInsights\(cluster\)/);
    assert.match(rail, /\{added \? "Added" : "Add cluster"\}/);
    for (const file of ["app/(dashboard)/audiences/[clientId]/page.tsx", "app/(dashboard)/audiences/[clientId]/new/audience-create-form.tsx"]) {
      const src = readFileSync(file);
      assert.match(src, /<AddedClustersFromInsights \/>/, file);
      assert.match(src, /surface="audience_builder"/, file);
    }
  });
});

function readFileSync(file: string): string {
  return readFile(file, "utf8");
}
