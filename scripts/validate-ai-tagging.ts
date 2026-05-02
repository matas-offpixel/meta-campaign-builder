#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import { autoTagWithDiagnostics } from "../lib/intelligence/auto-tagger.ts";
import {
  CREATIVE_TAG_DIMENSIONS,
  listCreativeTags,
  type CreativeTagDimension,
  type MotionCreativeTagRow,
} from "../lib/db/creative-tags.ts";
import type { ShareActiveCreativesResult } from "../lib/reporting/share-active-creatives.ts";
import type { ConceptGroupRow } from "../lib/reporting/group-creatives.ts";

const MODEL_VERSION = "gpt-4o-mini";
const ESTIMATED_USD_PER_CREATIVE = 0.001;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.SEED_USER_ID;
const openaiApiKey = process.env.OPENAI_API_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Source .env.local first.",
  );
}
if (!userId) throw new Error("Missing SEED_USER_ID.");
if (!openaiApiKey) throw new Error("Missing OPENAI_API_KEY.");

interface ManualAssignmentRow {
  event_id: string;
  creative_name: string;
  tag_id: string;
}

interface SnapshotRow {
  event_id: string;
  payload: ShareActiveCreativesResult;
  fetched_at: string;
}

interface Confusion {
  tp: number;
  fp: number;
  fn: number;
}

interface DimensionMetrics {
  precision: number;
  recall: number;
  f1: number;
  confusion: Confusion;
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const openai = new OpenAI({ apiKey: openaiApiKey });

const taxonomy = (await listCreativeTags(supabase)).filter(
  (row) => row.user_id === userId,
);
const tagById = new Map(taxonomy.map((row) => [row.id, row]));

const manualRows = await loadManualAssignments();
const manualByCreative = groupManualAssignments(manualRows, tagById);
const eventIds = [...new Set([...manualByCreative.keys()].map(splitKeyEventId))];
const snapshotsByEvent = await loadLatestSnapshots(eventIds);

const confusion = Object.fromEntries(
  CREATIVE_TAG_DIMENSIONS.map((dimension) => [
    dimension,
    { tp: 0, fp: 0, fn: 0 } satisfies Confusion,
  ]),
) as Record<CreativeTagDimension, Confusion>;
let totalCreatives = 0;
let missingSnapshot = 0;
let missingGroup = 0;
let missingThumbnail = 0;
let rawTagCount = 0;
let hallucinatedTagCount = 0;

for (const [key, manualByDimension] of manualByCreative) {
  const eventId = splitKeyEventId(key);
  const creativeName = splitKeyCreativeName(key);
  const payload = snapshotsByEvent.get(eventId);
  if (!payload || payload.kind !== "ok") {
    missingSnapshot += 1;
    continue;
  }

  const group = findConceptGroup(payload.groups, creativeName);
  if (!group) {
    missingGroup += 1;
    continue;
  }
  if (!group.representative_thumbnail) {
    missingThumbnail += 1;
    continue;
  }

  totalCreatives += 1;
  const predicted = await autoTagWithDiagnostics(
    {
      thumbnailUrl: group.representative_thumbnail,
      headline: group.representative_headline,
      body: group.representative_body_preview,
    },
    { taxonomy, openai, modelVersion: MODEL_VERSION },
  );
  rawTagCount += predicted.rawTagCount;
  hallucinatedTagCount += predicted.hallucinatedTagCount;
  const predictedByDimension = groupPredictions(predicted.tags);

  for (const dimension of CREATIVE_TAG_DIMENSIONS) {
    const manualSet = manualByDimension.get(dimension) ?? new Set<string>();
    const predictedSet =
      predictedByDimension.get(dimension) ?? new Set<string>();
    for (const valueKey of predictedSet) {
      if (manualSet.has(valueKey)) {
        confusion[dimension].tp += 1;
      } else {
        confusion[dimension].fp += 1;
      }
    }
    for (const valueKey of manualSet) {
      if (!predictedSet.has(valueKey)) confusion[dimension].fn += 1;
    }
  }
}

const byDimension = Object.fromEntries(
  CREATIVE_TAG_DIMENSIONS.map((dimension) => [
    dimension,
    metricsFor(confusion[dimension]),
  ]),
) as Record<CreativeTagDimension, DimensionMetrics>;

const output = {
  total_creatives: totalCreatives,
  skipped: {
    missing_snapshot: missingSnapshot,
    missing_concept_group: missingGroup,
    missing_thumbnail: missingThumbnail,
  },
  by_dimension: byDimension,
  hallucination: {
    raw_tags: rawTagCount,
    hallucinated_tags: hallucinatedTagCount,
  },
  hallucination_rate: round(
    rawTagCount === 0 ? 0 : hallucinatedTagCount / rawTagCount,
  ),
  gate: {
    asset_type: byDimension.asset_type.f1 >= 0.75,
    visual_format: byDimension.visual_format.f1 >= 0.75,
    messaging_angle: byDimension.messaging_angle.f1 >= 0.6,
    hook_tactic: byDimension.hook_tactic.f1 >= 0.6,
    hallucination_rate:
      (rawTagCount === 0 ? 0 : hallucinatedTagCount / rawTagCount) < 0.05,
  },
};

console.log(JSON.stringify(output, null, 2));
console.error(
  `[validate-ai-tagging] model=${MODEL_VERSION} creatives=${totalCreatives} estimated_openai_cost_usd=${(
    totalCreatives * ESTIMATED_USD_PER_CREATIVE
  ).toFixed(2)}`,
);

async function loadManualAssignments(): Promise<ManualAssignmentRow[]> {
  const { data, error } = await supabase
    .from("creative_tag_assignments")
    .select("event_id,creative_name,tag_id")
    .eq("user_id", userId)
    .eq("source", "manual");

  if (error) throw new Error(error.message);
  return (data ?? []) as ManualAssignmentRow[];
}

async function loadLatestSnapshots(
  eventIds: string[],
): Promise<Map<string, ShareActiveCreativesResult>> {
  if (eventIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("active_creatives_snapshots")
    .select("event_id,payload,fetched_at")
    .in("event_id", eventIds)
    .order("fetched_at", { ascending: false });

  if (error) throw new Error(error.message);

  const latest = new Map<string, ShareActiveCreativesResult>();
  for (const row of (data ?? []) as SnapshotRow[]) {
    if (!latest.has(row.event_id)) latest.set(row.event_id, row.payload);
  }
  return latest;
}

function groupManualAssignments(
  rows: ManualAssignmentRow[],
  tags: Map<string, MotionCreativeTagRow>,
): Map<string, Map<CreativeTagDimension, Set<string>>> {
  const grouped = new Map<string, Map<CreativeTagDimension, Set<string>>>();
  for (const row of rows) {
    const tag = tags.get(row.tag_id);
    if (!tag) continue;
    const key = creativeKey(row.event_id, row.creative_name);
    const byDimension = grouped.get(key) ?? new Map();
    const values = byDimension.get(tag.dimension) ?? new Set<string>();
    values.add(tag.value_key);
    byDimension.set(tag.dimension, values);
    grouped.set(key, byDimension);
  }
  return grouped;
}

function groupPredictions(
  rows: Array<{ dimension: CreativeTagDimension; value_key: string }>,
): Map<CreativeTagDimension, Set<string>> {
  const grouped = new Map<CreativeTagDimension, Set<string>>();
  for (const row of rows) {
    const values = grouped.get(row.dimension) ?? new Set<string>();
    values.add(row.value_key);
    grouped.set(row.dimension, values);
  }
  return grouped;
}

function findConceptGroup(
  groups: ConceptGroupRow[],
  creativeName: string,
): ConceptGroupRow | null {
  const target = creativeName.trim();
  return (
    groups.find(
      (group) =>
        group.display_name.trim() === target ||
        group.ad_names.some((name) => name.trim() === target),
    ) ?? null
  );
}

function metricsFor(c: Confusion): DimensionMetrics {
  const precision = c.tp + c.fp === 0 ? 0 : c.tp / (c.tp + c.fp);
  const recall = c.tp + c.fn === 0 ? 0 : c.tp / (c.tp + c.fn);
  const f1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    confusion: c,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function creativeKey(eventId: string, creativeName: string): string {
  return `${eventId}\u0000${creativeName}`;
}

function splitKeyEventId(key: string): string {
  return key.split("\u0000")[0];
}

function splitKeyCreativeName(key: string): string {
  return key.split("\u0000")[1] ?? "";
}
