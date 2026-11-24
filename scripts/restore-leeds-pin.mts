/**
 * Put the Leeds pin back into the seven drafts #1368 took Leeds, Kent
 * (811209) out of (LP5 of docs/design-record/2026-11-24-campaign-creator-location-pin.html).
 *
 *   npx tsx --env-file=/Users/liebus/meta-campaign-builder/.env.local scripts/restore-leeds-pin.mts
 *   npx tsx --env-file=/Users/liebus/meta-campaign-builder/.env.local scripts/restore-leeds-pin.mts --apply --expect <id>=<updated_at>,…
 *
 * Run --apply only after this PR is merged and deployed, when ops says so: a
 * pin in draft_json is read only by this code. The `--expect` list is the
 * one the dry run prints; each UPDATE is guarded on that updated_at, so a
 * draft edited since the dry run is left alone and reported.
 *
 * Where: exactly the ad sets #1368's run took the Kent entry out of, by
 * index, from its log (fix-leeds-kent-apply-1/-2-2026-11-24.txt, "Drafts"),
 * with each ad set's name as read on 24 Nov so a reordered draft is refused.
 *
 * What, per draft:
 *   - budgetSchedule.locationGroups gets the Leeds preset's pin group
 *     (`preset_leeds_pin`, "Leeds (pin) · 80 km", 53.7997, -1.5492, 80 km),
 *     with the tier the ad sets it goes to share (secondary on all seven);
 *   - each listed ad set's locationGroupIds gets `preset_leeds_pin`, and its
 *     stamped geoLocations snapshot gets the pin in custom_locations (the
 *     snapshot lost its 811209 city the same way).
 * Nothing else in the draft changes. No Meta call: the live ad sets already
 * carry the pin (#1368).
 *
 * --dry-run (default) Supabase reads only. Prints a table per draft: id,
 * status, updated_at, the tier, and the ad sets (index · name · tier) that
 * would get the pin; then the --expect list for --apply.
 */

import { createClient } from "@supabase/supabase-js";

import { PIN_PRESETS, isPresetPinGroup, presetPinGroup } from "../lib/meta/location-pins.ts";
import type { AdSetSuggestion, CampaignDraft, LocationTier } from "../lib/types.ts";

/** #1368's draft changes, by ad set index, with the names those ad sets carry. */
export const TARGETS: Record<string, { indices: number[]; names: Record<number, string> }> = {
  "330f5458-d390-41f5-99cd-d7b40f85cc9b": {
    indices: [2, 3, 5, 6, 8, 18, 20],
    names: {
      2: "Lineup — Secondary",
      3: "Lineup — Secondary – Adv+",
      5: "Techno Pages — Secondary",
      6: "Venue",
      8: "Data 1% Lookalike — Secondary",
      18: "Trance — Secondary",
      20: "Wide Adv+ - Secondary",
    },
  },
  "57ae0eab-25cb-42f1-b440-518096484098": {
    indices: [0, 3, 6, 7, 8, 9, 10, 11, 12],
    names: {
      0: "LP Rhythm — Adv+ — Secondary",
      3: "LP Rhythm — Secondary",
      6: "Disco Pages new — Secondary",
      7: "Electronic dance music (music), House music (music), Electronic music (music), E",
      8: "Fashion design (design), Luxury Lifestyle (website), Vogue (magazine), Designer ",
      9: "Boiler Room, Mixmag, NTS Radio, Music news and media (music)",
      10: "Spotify (streaming service), Deezer, SoundCloud, YouTube Music, Music and audio ",
      11: "Electronic dance music (music), Disco",
      12: "Ibiza, Nightclubs (bars, clubs and nightlife), nightlife (bars, clubs and nightl",
    },
  },
  "64043ff6-dc25-4c4f-ae73-134383d6154e": {
    indices: [2, 3, 5, 6, 8, 18, 20],
    names: {
      2: "Lineup — Secondary",
      3: "Lineup — Secondary – Adv+",
      5: "Techno Pages — Secondary",
      6: "Venue",
      8: "Data 1% Lookalike — Secondary",
      18: "Trance — Secondary",
      20: "Wide Adv+ - Secondary",
    },
  },
  "7c2589a0-bdb6-496f-a01f-7ad4d6bda620": {
    indices: [3, 6, 8, 17],
    names: { 3: "Disco Pages – Adv+", 6: "Lineup – Adv+", 8: "Lineup — Secondary Adv+ ", 17: "Adv+ Secondary" },
  },
  "7ca8e7fa-a818-4ccf-b8cc-91d910891db7": {
    indices: [2, 4, 7, 8, 10, 12],
    names: {
      2: "Data 1% Lookalike — Secondary",
      4: "Techno Pages — Secondary",
      7: "Lineup — Secondary",
      8: "Lineup — Secondary – Adv+",
      10: "Techno Pages — Secondary",
      12: "Retargeting — Secondary",
    },
  },
  "bf3cdcab-0d12-46b0-9ef3-7b9727b5b9ee": {
    indices: [3, 6, 8, 17],
    names: { 3: "Disco Pages – Adv+", 6: "Lineup – Adv+", 8: "Lineup — Secondary Adv+ ", 17: "Adv+ Secondary" },
  },
  "ff96de9a-a9b9-420c-8f8c-260e898c39d2": {
    indices: [2, 4, 7, 8, 10, 12],
    names: {
      2: "Data 1% Lookalike — Secondary",
      4: "Tech House Pages — Secondary",
      7: "Lineup — Secondary",
      8: "Lineup — Secondary – Adv+",
      10: "Disco Pages — Secondary",
      12: "Retargeting — Secondary",
    },
  },
};

const PIN_ID = PIN_PRESETS.leeds.id;
const KENT_KEY = "811209";

export interface DraftPlan {
  id: string;
  status: string;
  updatedAt: string;
  tier: LocationTier | undefined;
  adSets: { index: number; name: string; tier: string }[];
  refused: string[];
  next: CampaignDraft | null;
}

/** The plan for one draft. Pure: the draft is not mutated. */
export function planDraft(id: string, status: string, updatedAt: string, draft: CampaignDraft): DraftPlan {
  const target = TARGETS[id];
  const refused: string[] = [];
  const plan: DraftPlan = { id, status, updatedAt, tier: undefined, adSets: [], refused, next: null };
  if (!target) {
    refused.push("not one of the seven drafts");
    return plan;
  }
  const groups = draft.budgetSchedule?.locationGroups ?? [];
  const adSets = draft.adSetSuggestions ?? [];
  if (groups.some((g) => g.id === PIN_ID || isPresetPinGroup(g, "leeds"))) refused.push("already holds the Leeds pin");
  if (groups.some((g) => g.selections.some((s) => s.locationKey === KENT_KEY))) refused.push("still holds Leeds, Kent (811209)");

  const tiers = new Set<string>();
  for (const index of target.indices) {
    const adSet: AdSetSuggestion | undefined = adSets[index];
    const want = target.names[index];
    if (!adSet) {
      refused.push(`ad set [${index}] is missing`);
      continue;
    }
    if (adSet.name !== want) refused.push(`ad set [${index}] is "${adSet.name}", expected "${want}"`);
    if (!Array.isArray(adSet.locationGroupIds)) refused.push(`ad set [${index}] has no locationGroupIds`);
    if (adSet.locationGroupIds?.includes(PIN_ID)) refused.push(`ad set [${index}] already lists the pin`);
    if (adSet.locationTier) tiers.add(adSet.locationTier);
    plan.adSets.push({ index, name: adSet.name, tier: adSet.locationTier ?? "untiered" });
  }
  if (tiers.size > 1) refused.push(`the ad sets disagree on the tier (${[...tiers].join(", ")})`);
  plan.tier = tiers.size === 1 ? ([...tiers][0] as LocationTier) : undefined;
  if (refused.length) return plan;

  const pinGroup = presetPinGroup("leeds", { tier: plan.tier });
  const pinGeo = {
    latitude: PIN_PRESETS.leeds.latitude,
    longitude: PIN_PRESETS.leeds.longitude,
    radius: PIN_PRESETS.leeds.radiusKm,
    distance_unit: "kilometer" as const,
    name: PIN_PRESETS.leeds.name,
  };
  const wanted = new Set(target.indices);
  plan.next = {
    ...draft,
    budgetSchedule: { ...draft.budgetSchedule, locationGroups: [...groups, pinGroup] },
    adSetSuggestions: adSets.map((adSet, index) => {
      if (!wanted.has(index)) return adSet;
      return {
        ...adSet,
        locationGroupIds: [...(adSet.locationGroupIds ?? []), PIN_ID],
        ...(adSet.geoLocations
          ? {
              geoLocations: {
                ...adSet.geoLocations,
                custom_locations: [...(adSet.geoLocations.custom_locations ?? []), pinGeo],
              },
            }
          : {}),
      };
    }),
  };
  return plan;
}

function parseExpect(argv: string[]): Map<string, string> {
  const i = argv.indexOf("--expect");
  const out = new Map<string, string>();
  if (i < 0) return out;
  for (const pair of (argv[i + 1] ?? "").split(",")) {
    const at = pair.indexOf("=");
    if (at > 0) out.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--expect") {
      i++;
      continue;
    }
    if (a !== "--apply" && a !== "--dry-run") throw new Error(`unknown argument ${a}`);
  }
  const expect = parseExpect(argv);
  if (apply && expect.size !== Object.keys(TARGETS).length) {
    throw new Error("--apply needs --expect with all seven <id>=<updated_at> pairs, as the dry run prints them");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await supabase
    .from("campaign_drafts")
    .select("id,status,updated_at,draft_json")
    .in("id", Object.keys(TARGETS))
    .order("id");
  if (error) throw new Error(`drafts read: ${error.message}`);
  const rows = data ?? [];

  const plans = rows.map((row) =>
    planDraft(row.id as string, row.status as string, row.updated_at as string, row.draft_json as CampaignDraft),
  );
  for (const id of Object.keys(TARGETS)) {
    if (!rows.some((r) => r.id === id)) plans.push({ id, status: "missing", updatedAt: "", tier: undefined, adSets: [], refused: ["not found"], next: null });
  }

  console.log(`# Leeds pin back into ${Object.keys(TARGETS).length} drafts — ${apply ? "APPLY" : "dry run"}\n`);
  console.log("| draft | status | updated_at | pin tier | ad sets that get the pin (index · name · tier) | ready |");
  console.log("|---|---|---|---|---|---|");
  for (const p of plans) {
    const sets = p.adSets.map((a) => `[${a.index}] ${a.name.trim()} · ${a.tier}`).join("<br>");
    const ready = p.refused.length ? `no: ${p.refused.join("; ")}` : "yes";
    console.log(`| ${p.id} | ${p.status} | ${p.updatedAt} | ${p.tier ?? "none"} | ${sets} | ${ready} |`);
  }
  const ready = plans.filter((p) => p.next);
  console.log(`\nDrafts: ${plans.length}, ready ${ready.length}. Ad sets that get the pin: ${ready.reduce((n, p) => n + p.adSets.length, 0)}.`);
  console.log(`\n--expect ${plans.map((p) => `${p.id}=${p.updatedAt}`).join(",")}`);

  if (!apply) return;
  if (ready.length !== plans.length) {
    console.log("\nNot applied: every draft must be ready.");
    process.exitCode = 1;
    return;
  }
  console.log("\n## Apply\n");
  for (const p of ready) {
    const want = expect.get(p.id);
    if (want !== p.updatedAt) {
      console.log(`${p.id} skipped: updated_at is ${p.updatedAt}, the dry run read ${want ?? "nothing"}`);
      continue;
    }
    const { data: updated, error: upErr } = await supabase
      .from("campaign_drafts")
      .update({ draft_json: p.next, updated_at: new Date().toISOString() })
      .eq("id", p.id)
      .eq("updated_at", p.updatedAt)
      .select("id");
    if (upErr) console.log(`${p.id} failed: ${upErr.message}`);
    else if (!updated?.length) console.log(`${p.id} not updated: edited since the read (updated_at moved)`);
    else console.log(`${p.id} updated: pin group + ${p.adSets.length} ad sets`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
