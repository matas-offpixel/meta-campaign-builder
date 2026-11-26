/**
 * Location expansion off on every ad set the app creates
 * (cc/meta-geo-expansion-off): `targeting_automation.individual_setting.geo = 0`,
 * merged beside #1387's age suggestion (`individual_setting.age = 1`, top-level
 * `age_range`), never over it. Then one read-back of `targeting` per ≤ 50
 * created ad sets; anything Meta didn't keep at 0 gets a launch-result line.
 *
 * Run: node --conditions react-server --experimental-strip-types --test lib/meta/__tests__/geo-expansion.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildAdSetPayload, buildMetaTargeting, withoutAgeSuggestion } from "../adset.ts";
import {
  GEO_READ_BACK_BATCH,
  GEO_WORDS,
  checkLocationExpansion,
  geoExpansionOf,
  locationExpansionNotes,
  readBackGeoExpansion,
  withGeoExpansionOff,
} from "../geo-expansion.ts";
import type { AdSetSuggestion, AudienceSettings, BudgetScheduleSettings } from "../../types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const audiences = {
  interestGroups: [],
  customAudienceGroups: [{ id: "cag", name: "Crossover pages", audienceIds: ["120250923818990239"], suggestionsOnly: true }],
  pageGroups: [],
  savedAudiences: { audienceIds: [] },
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

const schedule = { startDate: "", endDate: "" } as unknown as BudgetScheduleSettings;

function adSet(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "as1",
    name: "Broad + suggestions",
    sourceType: "custom_group",
    sourceId: "cag",
    sourceName: "Crossover pages",
    ageMin: 18,
    ageMax: 45,
    budgetPerDay: 40,
    advantagePlus: true,
    enabled: true,
    geoLocations: { countries: ["GB"], cities: [{ key: "2421178", radius: 25, distance_unit: "kilometer" }] },
    ...overrides,
  } as AdSetSuggestion;
}

describe("buildMetaTargeting: geo 0 on both targeting_automation branches", () => {
  it("Advantage+ with the age suggestion: geo 0 beside age 1, age_range and the controls kept", () => {
    const t = buildMetaTargeting(adSet(), audiences);
    assert.deepEqual(t.targeting_automation, { advantage_audience: 1, individual_setting: { age: 1, geo: 0 } });
    assert.deepEqual(t.age_range, [18, 45]);
    assert.equal(t.age_min, 18);
    assert.equal(t.age_max, 65);
  });

  it("Advantage+ at the full range (no suggestion): individual_setting is { geo: 0 }", () => {
    const t = buildMetaTargeting(adSet({ ageMin: 18, ageMax: 65 }), audiences);
    assert.deepEqual(t.targeting_automation, { advantage_audience: 1, individual_setting: { geo: 0 } });
    assert.equal(t.age_range, undefined);
  });

  it("Advantage+ off (strict): advantage_audience 0 with individual_setting { geo: 0 }", () => {
    const t = buildMetaTargeting(adSet({ advantagePlus: false, sourceType: "custom_group" }), {
      ...audiences,
      customAudienceGroups: [{ id: "cag", name: "Crossover pages", audienceIds: ["120250923818990239"] }],
    } as unknown as AudienceSettings);
    assert.deepEqual(t.targeting_automation, { advantage_audience: 0, individual_setting: { geo: 0 } });
    assert.equal(t.age_min, 18);
    assert.equal(t.age_max, 45);
  });

  it("a blank ad set (always Advantage+) gets it too", () => {
    const t = buildMetaTargeting(adSet({ sourceType: "blank", sourceId: "", advantagePlus: false }), audiences);
    assert.equal(t.targeting_automation?.individual_setting?.geo, 0);
    assert.equal(t.targeting_automation?.advantage_audience, 1);
  });

  it("the payload the launch sends carries geo and age together", () => {
    const p = buildAdSetPayload(adSet(), "120200000000000001", audiences, schedule, "conversions", "purchase", "1234567890", false, undefined, "PAUSED");
    assert.deepEqual(p.targeting.targeting_automation, { advantage_audience: 1, individual_setting: { age: 1, geo: 0 } });
    assert.deepEqual(p.targeting.age_range, [18, 45]);
  });

  it("step 2 of the age order (withoutAgeSuggestion) drops age and keeps geo 0", () => {
    const t = withoutAgeSuggestion(buildMetaTargeting(adSet(), audiences));
    assert.deepEqual(t.targeting_automation, { advantage_audience: 1, individual_setting: { geo: 0 } });
    assert.equal(t.age_range, undefined);
  });
});

describe("withGeoExpansionOff", () => {
  it("merges into what's there, never over it, and doesn't touch the input", () => {
    const input = { age_range: [25, 35], targeting_automation: { advantage_audience: 1, individual_setting: { age: 1 } } };
    const out = withGeoExpansionOff(input);
    assert.deepEqual(out, { age_range: [25, 35], targeting_automation: { advantage_audience: 1, individual_setting: { age: 1, geo: 0 } } });
    assert.deepEqual(input.targeting_automation, { advantage_audience: 1, individual_setting: { age: 1 } });
  });

  it("turns a copied geo 1 (an on-sale copy of a live ad set) to 0", () => {
    const out = withGeoExpansionOff({ targeting_automation: { advantage_audience: 0, individual_setting: { geo: 1 } } });
    assert.deepEqual(out.targeting_automation, { advantage_audience: 0, individual_setting: { geo: 0 } });
  });

  it("adds individual_setting to a targeting with none, keeping advantage_audience", () => {
    assert.deepEqual(withGeoExpansionOff({ targeting_automation: { advantage_audience: 0 } }).targeting_automation, {
      advantage_audience: 0,
      individual_setting: { geo: 0 },
    });
  });
});

describe("geoExpansionOf", () => {
  it("reads on, off, not set; null without targeting", () => {
    assert.equal(geoExpansionOf({ targeting_automation: { individual_setting: { geo: 0 } } }), "off");
    assert.equal(geoExpansionOf({ targeting_automation: { individual_setting: { geo: 1 } } }), "on");
    assert.equal(geoExpansionOf({ targeting_automation: { individual_setting: { age: 1 } } }), "not_set");
    assert.equal(geoExpansionOf({ targeting_automation: { advantage_audience: 1 } }), "not_set");
    assert.equal(geoExpansionOf({ age_min: 18 }), "not_set");
    assert.equal(geoExpansionOf(undefined), null);
  });
});

const ids = (n: number, from = 120250000000000000n) => Array.from({ length: n }, (_, i) => String(from + BigInt(i)));

describe("read-back after create", () => {
  it("one GET per ≤ 50 created ad sets; off reads produce no line", async () => {
    const created = ids(73).map((id, i) => ({ name: `Ad set ${i}`, metaAdSetId: id }));
    const batches: string[][] = [];
    const { notes, gets } = await checkLocationExpansion(created, async (batch) => {
      batches.push(batch);
      return Object.fromEntries(batch.map((id) => [id, { id, targeting: { targeting_automation: { advantage_audience: 1, individual_setting: { age: 1, geo: 0 } } } }]));
    });
    assert.deepEqual(notes, []);
    assert.equal(gets, 2);
    assert.deepEqual(batches.map((b) => b.length), [GEO_READ_BACK_BATCH, 23]);
  });

  it("Meta not returning 0 names the ad set to untick; a missing key is not taken as off", async () => {
    const [a, b, c] = ids(3);
    const { notes } = await checkLocationExpansion(
      [
        { name: "Broad", metaAdSetId: a! },
        { name: "Crossover pages", metaAdSetId: b! },
        { name: "Lookalike 1%", metaAdSetId: c! },
      ],
      async () => ({
        [a!]: { targeting: { targeting_automation: { individual_setting: { geo: 0 } } } },
        [b!]: { targeting: { targeting_automation: { individual_setting: { geo: 1 } } } },
        [c!]: { targeting: { targeting_automation: { advantage_audience: 0 } } },
      }),
    );
    assert.deepEqual(notes, [
      { name: "Crossover pages", metaAdSetId: b!, state: "on", message: "Untick 'Reach more people likely to respond to your ads' in Ads Manager for Crossover pages." },
      { name: "Lookalike 1%", metaAdSetId: c!, state: "not_set", message: "Untick 'Reach more people likely to respond to your ads' in Ads Manager for Lookalike 1%." },
    ]);
  });

  it("a failed read-back is said, never treated as off", async () => {
    const created = ids(52).map((id, i) => ({ name: `Ad set ${i}`, metaAdSetId: id }));
    let call = 0;
    const read = await readBackGeoExpansion(
      created.map((c) => c.metaAdSetId),
      async (batch) => {
        call += 1;
        if (call === 1) throw new Error("rate limited");
        // Second batch: Meta leaves one id out.
        return { [batch[0]!]: { targeting: { targeting_automation: { individual_setting: { geo: 0 } } } } };
      },
    );
    assert.equal(read.gets, 2);
    const notes = locationExpansionNotes(created, read);
    assert.equal(notes.length, 51);
    assert.ok(notes.every((n) => n.state === "not_read"));
    assert.equal(notes[0]!.message, GEO_WORDS.notRead("Ad set 0"));
    assert.ok(!notes.some((n) => n.metaAdSetId === created[50]!.metaAdSetId), "the one read as 0 has no line");
  });

  it("nothing created → no GET", async () => {
    let called = false;
    const out = await checkLocationExpansion([], async () => ((called = true), {}));
    assert.deepEqual(out, { notes: [], gets: 0 });
    assert.equal(called, false);
  });

  it("an ad set listed twice (primary campaign + attach results) gets one line", () => {
    const [a] = ids(1);
    const notes = locationExpansionNotes(
      [{ name: "Broad", metaAdSetId: a! }, { name: "Broad", metaAdSetId: a! }],
      { states: new Map([[a!, "on"]]), gets: 1 },
    );
    assert.equal(notes.length, 1);
  });
});

describe("every create goes through the guarded client", () => {
  const client = readFileSync(join(ROOT, "lib/meta/client.ts"), "utf8");
  const body = (name: string) => {
    const at = client.indexOf(`export async function ${name}(`);
    assert.ok(at >= 0, name);
    const next = client.indexOf("\nexport ", at + 1);
    return client.slice(at, next);
  };

  it("createMetaAdSet and createMetaAdSets send withLocationExpansionOff(payload)", () => {
    for (const name of ["createMetaAdSet", "createMetaAdSets"]) {
      const b = body(name);
      assert.match(b, /\/adsets`,\s*withLocationExpansionOff\(payload\),/, name);
      assert.doesNotMatch(b, /payload as unknown as Record<string, unknown>/, name);
    }
    assert.match(client, /function withLocationExpansionOff[\s\S]*?withGeoExpansionOff\(targeting\)/);
  });

  it("no other code POSTs to an ad account's /adsets edge", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx|mts)$/.test(entry) && !/\.test\./.test(entry)) {
          const src = readFileSync(path, "utf8");
          for (const m of src.matchAll(/graphPost(?:WithToken)?\s*(?:<[^>]*>)?\(\s*`[^`]*\/adsets`/g)) hits.push(`${relative(ROOT, path)}: ${m[0].slice(0, 60)}`);
        }
      }
    };
    for (const dir of ["lib", "app", "scripts"]) walk(join(ROOT, dir));
    assert.deepEqual(
      hits.filter((h) => !h.startsWith("lib/meta/client.ts")),
      [],
    );
  });
});
