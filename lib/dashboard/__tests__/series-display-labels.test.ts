import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

import {
  getSeriesDisplayLabel,
  SERIES_DISPLAY_LABELS,
} from "../series-display-labels.ts";

const FOURTHEFANS_CLIENT_ID = "37906506-56b7-4d58-ab62-1b042e2b561a";
const ACTIVE_SERIES_STATUSES = ["upcoming", "announced", "on_sale"];
const BRANDED_SERIES_PREFIXES = ["4TF", "LEEDS26"];
const HAS_PRODUCTION_AUDIT_ENV = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

function isBrandedSeriesEventCode(eventCode: string): boolean {
  return BRANDED_SERIES_PREFIXES.some((prefix) => eventCode.startsWith(prefix));
}

describe("getSeriesDisplayLabel", () => {
  it("returns null for missing / empty code", () => {
    assert.equal(getSeriesDisplayLabel(null), null);
    assert.equal(getSeriesDisplayLabel(undefined), null);
    assert.equal(getSeriesDisplayLabel(""), null);
  });

  it("returns mapped label when present", () => {
    assert.equal(
      getSeriesDisplayLabel("4TF-TITLERUNIN-LONDON"),
      "Arsenal Title Run In",
    );
    assert.equal(SERIES_DISPLAY_LABELS["LEEDS26-FACUP"], "Leeds FA Cup Semi Final");
  });

  it("covers renamed Villa and Palace final event codes", () => {
    assert.equal(
      getSeriesDisplayLabel("4TF26-VILLA-FINAL"),
      "Aston Villa Europa League Final",
    );
    assert.equal(
      getSeriesDisplayLabel("4TF26-PALACE-FINAL"),
      "Crystal Palace Conference League Final",
    );
  });

  it("returns null when code is not in the map", () => {
    assert.equal(getSeriesDisplayLabel("WC26-BRIGHTON"), null);
  });

  it(
    "covers every active branded 4theFans production event code",
    { skip: !HAS_PRODUCTION_AUDIT_ENV },
    async () => {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        },
      );

      const { data, error } = await supabase
        .from("events")
        .select("event_code")
        .eq("client_id", FOURTHEFANS_CLIENT_ID)
        .in("status", ACTIVE_SERIES_STATUSES)
        .not("event_code", "is", null)
        .range(0, 999);

      if (error) throw error;

      const activeBrandedCodes = [...new Set(
        (data ?? [])
          .map((row) =>
            typeof row.event_code === "string" ? row.event_code.trim() : ""
          )
          .filter((code) => code && isBrandedSeriesEventCode(code)),
      )].sort();

      const missingMappings = activeBrandedCodes.filter(
        (code) => !SERIES_DISPLAY_LABELS[code],
      );

      assert.deepEqual(
        missingMappings,
        [],
        `Missing series display labels for active production codes: ${missingMappings.join(", ")}`,
      );
    },
  );
});
