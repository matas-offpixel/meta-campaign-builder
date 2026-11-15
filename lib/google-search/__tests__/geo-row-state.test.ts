import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { serializeGeoTargetsColumn } from "../geo-targets-codec.ts";
import {
  addEmptyGeoRow,
  applyGeoResolution,
  createGeoResolveSession,
  editGeoLocation,
  geoRowsFromTargets,
  removeGeoRow,
  resolutionMatchesLocation,
  syncGeoRows,
  geoDisplayName,
  trustedGeoResourceName,
  type GeoRowModel,
} from "../geo-row-state.ts";
import type { GoogleSearchGeoTarget } from "../types.ts";

function sequentialIds(prefix = "row"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const NEWCASTLE: GoogleSearchGeoTarget = {
  location: "Newcastle",
  bid_modifier_pct: null,
  resolved_resource_name: "geoTargetConstants/1006851",
  resolved_name: "Newcastle upon Tyne, England, United Kingdom",
};
const SUNDERLAND: GoogleSearchGeoTarget = {
  location: "Sunderland",
  bid_modifier_pct: null,
  resolved_resource_name: "geoTargetConstants/1006918",
  resolved_name: "Sunderland, England, United Kingdom",
};
const LONDON: GoogleSearchGeoTarget = {
  location: "London",
  bid_modifier_pct: null,
  resolved_resource_name: "geoTargetConstants/1006886",
  resolved_name: "London, England, United Kingdom",
};

function canonical(row: GeoRowModel): string | undefined {
  return row.resolve.status === "matched" ? row.resolve.canonicalName : undefined;
}

describe("geo row edits survive a late resolve", () => {
  it('types "Newcastl" then "United Kingdom" before the first response: stores the United Kingdom resolution', () => {
    const ids = sequentialIds();
    let rows = geoRowsFromTargets([{ location: "", bid_modifier_pct: null }], ids);
    const id = rows[0].id;

    rows = editGeoLocation(rows, id, "Newcastl");
    assert.equal(rows[0].resolve.status, "loading");
    assert.equal(rows[0].geo.resolved_resource_name, null);

    rows = editGeoLocation(rows, id, "United Kingdom");
    rows = applyGeoResolution(rows, id, "Newcastl", {
      resourceName: "geoTargetConstants/1006851",
      canonicalName: "Newcastle upon Tyne, England, United Kingdom",
    });

    assert.equal(rows[0].geo.location, "United Kingdom");
    assert.equal(rows[0].geo.resolved_resource_name, null);
    assert.equal(rows[0].geo.resolved_name, null);
    assert.equal(rows[0].resolve.status, "loading");
    assert.notEqual(canonical(rows[0]), "Newcastle upon Tyne, England, United Kingdom");

    rows = applyGeoResolution(rows, id, "United Kingdom", {
      resourceName: "geoTargetConstants/2826",
      canonicalName: "United Kingdom",
    });
    assert.equal(rows[0].geo.resolved_resource_name, "geoTargetConstants/2826");
    assert.equal(rows[0].geo.resolved_name, "United Kingdom");
    assert.equal(canonical(rows[0]), "United Kingdom");
  });

  it("keeps a second row added while the first row's resolve is in flight", () => {
    const ids = sequentialIds();
    let rows = geoRowsFromTargets([{ location: "Newcastle", bid_modifier_pct: null }], ids);
    const first = rows[0].id;
    rows = editGeoLocation(rows, first, "Newcastle");
    rows = addEmptyGeoRow(rows, ids);
    rows = applyGeoResolution(rows, first, "Newcastle", {
      resourceName: NEWCASTLE.resolved_resource_name!,
      canonicalName: NEWCASTLE.resolved_name!,
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[1].geo.location, "");
    assert.equal(rows[1].resolve.status, "idle");
    assert.equal(rows[0].geo.resolved_resource_name, NEWCASTLE.resolved_resource_name);
    assert.equal(canonical(rows[0]), NEWCASTLE.resolved_name);
  });

  it("keeps the ticks of rows 2 and 3 when row 1 is removed", () => {
    const rows = geoRowsFromTargets([NEWCASTLE, SUNDERLAND, LONDON], sequentialIds());
    assert.deepEqual(rows.map(canonical), [
      NEWCASTLE.resolved_name,
      SUNDERLAND.resolved_name,
      LONDON.resolved_name,
    ]);

    const next = removeGeoRow(rows, rows[0].id);
    assert.deepEqual(next.map((row) => row.id), [rows[1].id, rows[2].id]);
    assert.equal(canonical(next[0]), SUNDERLAND.resolved_name);
    assert.equal(canonical(next[1]), LONDON.resolved_name);
    assert.equal(next[0].geo.resolved_resource_name, SUNDERLAND.resolved_resource_name);
    assert.equal(next[1].geo.resolved_resource_name, LONDON.resolved_resource_name);
  });

  it("adds an empty geo row", () => {
    const rows = addEmptyGeoRow([], () => "fresh");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "fresh");
    assert.deepEqual(rows[0].geo, { location: "", bid_modifier_pct: null });
    assert.deepEqual(rows[0].resolve, { status: "idle" });
  });

  it("does not show a tick for a resolution made for different text", () => {
    const rows = geoRowsFromTargets(
      [
        {
          location: "United Kingdom",
          bid_modifier_pct: null,
          resolved_resource_name: "geoTargetConstants/1006851",
          resolved_name: "Newcastle upon Tyne, England, United Kingdom",
        },
      ],
      () => "uk",
    );
    assert.equal(rows[0].resolve.status, "loading");
    assert.equal(canonical(rows[0]), undefined);
  });
});

describe("stored geo resolution belongs to the location text", () => {
  it("trusts a name that starts with the typed text, including a short prefix", () => {
    assert.equal(
      resolutionMatchesLocation("sunderlan", "Sunderland, England, United Kingdom"),
      true,
    );
    assert.equal(
      resolutionMatchesLocation("london", "London, England, United Kingdom"),
      true,
    );
    assert.equal(resolutionMatchesLocation("United Kingdom", "United Kingdom"), true);
  });

  it("does not trust a canonical name that merely contains the typed text", () => {
    assert.equal(
      resolutionMatchesLocation(
        "United Kingdom",
        "Newcastle upon Tyne, England, United Kingdom",
      ),
      false,
    );
    assert.equal(
      trustedGeoResourceName({
        location: "United Kingdom",
        bid_modifier_pct: null,
        resolved_resource_name: "geoTargetConstants/1006851",
        resolved_name: "Newcastle upon Tyne, England, United Kingdom",
      }),
      null,
    );
  });

  it("shows the typed location when the stored name belongs to a different place", () => {
    assert.equal(
      geoDisplayName({
        location: "United Kingdom",
        resolved_resource_name: "geoTargetConstants/1006851",
        resolved_name: "Newcastle upon Tyne, England, United Kingdom",
      }),
      "United Kingdom",
    );
    assert.equal(
      geoDisplayName({
        location: "London",
        resolved_resource_name: "geoTargetConstants/1006886",
        resolved_name: "London, England, United Kingdom",
      }),
      "London, England, United Kingdom",
    );
  });

  it("trusts a resource name when no canonical name is stored to contradict it", () => {
    assert.equal(
      trustedGeoResourceName({
        location: "london",
        bid_modifier_pct: null,
        resolved_resource_name: "geoTargetConstants/1006886",
      }),
      "geoTargetConstants/1006886",
    );
  });
});

describe("geo resolve session", () => {
  it("aborts the in-flight request on the next keystroke and on unmount", () => {
    const session = createGeoResolveSession();
    const first = session.start();
    session.abort();
    assert.equal(first.signal.aborted, true);

    const second = session.start();
    assert.equal(second.signal.aborted, false);
    const third = session.start();
    assert.equal(second.signal.aborted, true);
    assert.equal(third.signal.aborted, false);
    session.abort();
    assert.equal(third.signal.aborted, true);
  });
});

describe("geo row identity is not part of the saved shape", () => {
  it("drops a client id and resolved_for on the way through the codec", () => {
    const wire = serializeGeoTargetsColumn({
      targets: [
        {
          location: "London",
          bid_modifier_pct: null,
          resolved_resource_name: "geoTargetConstants/1006886",
          resolved_name: "London, England, United Kingdom",
          clientId: "row-1",
          resolved_for: "Newcastle",
        } as GoogleSearchGeoTarget & { clientId: string; resolved_for: string },
      ],
      geo_target_type: "PRESENCE",
    });
    const saved = wire.targets[0] as unknown as Record<string, unknown>;
    assert.equal("clientId" in saved, false);
    assert.equal("resolved_for" in saved, false);
    assert.equal(saved.resolved_resource_name, "geoTargetConstants/1006886");
  });

  it("keeps ids and ticks when the saved list comes back without client ids", () => {
    const rows = geoRowsFromTargets([NEWCASTLE, SUNDERLAND], sequentialIds());
    const echoed: GoogleSearchGeoTarget[] = rows.map((row) => ({ ...row.geo }));
    const synced = syncGeoRows(rows, echoed, sequentialIds("new"));
    assert.deepEqual(
      synced.map((row) => row.id),
      rows.map((row) => row.id),
    );
    assert.equal(canonical(synced[0]), NEWCASTLE.resolved_name);
    assert.equal(canonical(synced[1]), SUNDERLAND.resolved_name);
  });
});
