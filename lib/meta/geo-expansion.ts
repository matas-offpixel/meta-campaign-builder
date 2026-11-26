/**
 * lib/meta/geo-expansion.ts — Meta's location expansion, off on every ad set
 * the app creates.
 *
 * The setting is `targeting.targeting_automation.individual_setting.geo`:
 * 1 = on, 0 = off. Meta, Advanced targeting reference: "To opt out, set the
 * `geo` parameter under `individual_setting` in `targeting_automation` to
 * `0`." It is the Ads Manager tick "Reach more people likely to respond to
 * your ads", and only applies when `geo_locations` has cities or regions.
 * Meta documents no default, and most live ad sets carry no `geo` key at
 * all, so a missing key is "not set", never proof it is off.
 *
 * `geo` sits in the same `individual_setting` object as #1387's age
 * suggestion (`age: 1`), so it is always merged in, never written over it.
 *
 * Every create goes through `createMetaAdSet` / `createMetaAdSets`
 * (lib/meta/client.ts), which apply {@link withGeoExpansionOff} to the
 * payload's targeting; `buildMetaTargeting` (lib/meta/adset.ts) also sets it,
 * so the payloads the wizard builds already carry it.
 *
 * After a create, one read of `targeting` per created ad set (batched, at
 * most 50 ids a GET) checks what Meta kept: read-only, never a retry write.
 *
 * Pure. Relative imports only (node:test).
 */

/** The value sent: location expansion off. */
export const GEO_EXPANSION_OFF = 0 as const;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

/**
 * The targeting with `targeting_automation.individual_setting.geo = 0`,
 * everything else as it was: `advantage_audience`, `individual_setting.age`
 * and the top-level `age_range` stay. Returns a new object.
 */
export function withGeoExpansionOff<T extends object>(targeting: T): T {
  const automation = obj((targeting as Json).targeting_automation) ?? {};
  const individual = obj(automation.individual_setting) ?? {};
  return {
    ...targeting,
    targeting_automation: { ...automation, individual_setting: { ...individual, geo: GEO_EXPANSION_OFF } },
  };
}

/** What Meta holds: "off" (geo 0), "on" (geo 1, or any other value), "not_set" (no geo key). */
export type GeoExpansionState = "off" | "on" | "not_set";

/** Location expansion on a read targeting; null when there is no targeting to read. */
export function geoExpansionOf(targeting: unknown): GeoExpansionState | null {
  const t = obj(targeting);
  if (!t) return null;
  const individual = obj(obj(t.targeting_automation)?.individual_setting);
  if (!individual || !("geo" in individual) || individual.geo == null) return "not_set";
  return Number(individual.geo) === 0 ? "off" : "on";
}

/** Graph's `ids` limit, as the app keeps it everywhere. */
export const GEO_READ_BACK_BATCH = 50;

/** One batched `GET /?ids=…&fields=targeting`: the response keyed by id. */
export type GetTargetingByIds = (ids: string[]) => Promise<Record<string, unknown>>;

export interface GeoReadBack {
  /** Per created ad set id: what Meta holds, or "not_read" when the read failed or Meta returned no targeting. */
  states: Map<string, GeoExpansionState | "not_read">;
  /** GETs sent (one per ≤ 50 ids). */
  gets: number;
}

/**
 * Reads back `targeting` for the ad sets just created, at most 50 a GET. A
 * batch that throws, or an id Meta leaves out, is "not_read": said, never
 * taken as off. Read-only.
 */
export async function readBackGeoExpansion(ids: readonly string[], get: GetTargetingByIds): Promise<GeoReadBack> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.trim() !== ""))];
  const states = new Map<string, GeoExpansionState | "not_read">();
  let gets = 0;
  for (let i = 0; i < unique.length; i += GEO_READ_BACK_BATCH) {
    const batch = unique.slice(i, i + GEO_READ_BACK_BATCH);
    gets += 1;
    let json: Record<string, unknown>;
    try {
      json = (await get(batch)) ?? {};
    } catch {
      for (const id of batch) states.set(id, "not_read");
      continue;
    }
    for (const id of batch) states.set(id, geoExpansionOf(obj(json[id])?.targeting) ?? "not_read");
  }
  return { states, gets };
}

export const GEO_WORDS = {
  /**
   * PENDING DESIGN launch.adset.geo_expansion_untick — Job 4's string
   * (cc/mcp-m3c-retargeting), reused as is: Meta didn't keep geo 0.
   */
  untick: (adSet: string) => `Untick 'Reach more people likely to respond to your ads' in Ads Manager for ${adSet}.`,
  /** PENDING DESIGN launch.adset.geo_expansion_not_read — the read-back failed, so it isn't known to be off. */
  notRead: (adSet: string) =>
    `Location expansion couldn't be read back for ${adSet}, so it may be on. Check 'Reach more people likely to respond to your ads' in Ads Manager.`,
} as const;

/** One created ad set whose location expansion isn't known to be off. */
export interface LocationExpansionNote {
  name: string;
  metaAdSetId: string;
  /** "on" / "not_set": Meta didn't return geo 0. "not_read": the read-back failed. */
  state: "on" | "not_set" | "not_read";
  message: string;
}

/**
 * The launch result's lines: one per created ad set Meta didn't return geo 0
 * for, in creation order. Empty when every one reads off.
 */
export function locationExpansionNotes(
  created: readonly { name: string; metaAdSetId: string }[],
  readBack: GeoReadBack,
): LocationExpansionNote[] {
  const out: LocationExpansionNote[] = [];
  const seen = new Set<string>();
  for (const c of created) {
    if (seen.has(c.metaAdSetId)) continue;
    seen.add(c.metaAdSetId);
    const state = readBack.states.get(c.metaAdSetId) ?? "not_read";
    if (state === "off") continue;
    out.push({
      name: c.name,
      metaAdSetId: c.metaAdSetId,
      state,
      message: state === "not_read" ? GEO_WORDS.notRead(c.name) : GEO_WORDS.untick(c.name),
    });
  }
  return out;
}

/** Read back and build the lines in one step. Never throws: a failed read is a "not_read" line. */
export async function checkLocationExpansion(
  created: readonly { name: string; metaAdSetId: string }[],
  get: GetTargetingByIds,
): Promise<{ notes: LocationExpansionNote[]; gets: number }> {
  if (created.length === 0) return { notes: [], gets: 0 };
  const readBack = await readBackGeoExpansion(
    created.map((c) => c.metaAdSetId),
    get,
  );
  return { notes: locationExpansionNotes(created, readBack), gets: readBack.gets };
}
