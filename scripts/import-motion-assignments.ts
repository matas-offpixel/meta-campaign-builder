#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  bulkUpsertCreativeTagAssignments,
  extractMotionSeedTags,
  importMotionSeedTags,
  type CreativeTagDimension,
  type MotionCreativeTagRow,
} from "../lib/db/creative-tags.ts";
import { resolveMotionAssignments } from "../lib/motion/assignment-resolver.ts";

interface EventRow {
  id: string;
  event_code: string | null;
}

type TaxonomyRow = Pick<MotionCreativeTagRow, "id" | "dimension" | "value_key">;

const dryRun = process.argv.includes("--dry-run");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.SEED_USER_ID;
const glossaryPath = resolve(
  process.cwd(),
  process.env.MOTION_GLOSSARY_PATH ??
    "docs/motion-research/01-glossary-with-creative-ids.json",
);
const insightsPath = resolve(
  process.cwd(),
  process.env.MOTION_INSIGHTS_PATH ??
    "docs/motion-research/03-creative-insights-90d-top50.json",
);

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Source .env.local first.",
  );
}

if (!userId) {
  throw new Error("Missing SEED_USER_ID. Pass the owner user uuid.");
}

const requiredSupabaseUrl: string = supabaseUrl;
const requiredServiceRoleKey: string = serviceRoleKey;
const seedUserId: string = userId;

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const [glossary, insights] = await Promise.all([
    readJson(glossaryPath),
    readJson(insightsPath),
  ]);
  const supabase = createClient(requiredSupabaseUrl, requiredServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const taxonomySeed = dryRun
    ? { inserted: 0, skipped: 0 }
    : await importMotionSeedTags(supabase, seedUserId, glossary);
  const [
    { data: events, error: eventsError },
    { data: taxonomy, error: tagsError },
  ] = await Promise.all([
    supabase.from("events").select("id,event_code").eq("user_id", seedUserId),
    supabase
      .from("creative_tags")
      .select("id,dimension,value_key")
      .eq("user_id", seedUserId)
      .not("dimension", "is", null),
  ]);

  if (eventsError) throw new Error(eventsError.message);
  if (tagsError) throw new Error(tagsError.message);

  const resolved = resolveMotionAssignments(
    glossary,
    insights,
    events as EventRow[],
  );
  const tagIdByKey = new Map(
    ((taxonomy ?? []) as TaxonomyRow[]).map((row) => [
      taxonomyKey(row.dimension, row.value_key),
      row.id,
    ]),
  );
  const persistedTagKeys = new Set(tagIdByKey.keys());
  if (dryRun) {
    for (const tag of extractMotionSeedTags(glossary)) {
      const key = taxonomyKey(tag.dimension, tag.valueKey);
      if (!tagIdByKey.has(key)) tagIdByKey.set(key, `dry-run:${key}`);
    }
  }
  const missingTaxonomy = new Map<string, number>();
  const rows = [];

  for (const assignment of resolved.assignments) {
    const tagId = tagIdByKey.get(
      taxonomyKey(assignment.dimension, assignment.value_key),
    );
    if (!tagId) {
      const key = taxonomyKey(assignment.dimension, assignment.value_key);
      missingTaxonomy.set(key, (missingTaxonomy.get(key) ?? 0) + 1);
      continue;
    }
    rows.push({
      userId: seedUserId,
      eventId: assignment.event_id,
      creativeName: assignment.creative_name,
      tagId,
      source: assignment.source,
    });
  }

  const byDimension: Record<string, number> = {};
  for (const assignment of resolved.assignments) {
    const hasTaxonomy = tagIdByKey.has(
      taxonomyKey(assignment.dimension, assignment.value_key),
    );
    if (hasTaxonomy) {
      byDimension[assignment.dimension] =
        (byDimension[assignment.dimension] ?? 0) + 1;
    }
  }

  const writeResult = dryRun
    ? { inserted: 0, updated: 0 }
    : await bulkUpsertCreativeTagAssignments(supabase, rows);

  console.log(
    JSON.stringify(
      {
        user_id: seedUserId,
        dry_run: dryRun,
        glossary_path: glossaryPath,
        insights_path: insightsPath,
        mapped_creatives: resolved.report.mapped_creatives,
        dropped_creatives: resolved.report.dropped_creatives,
        dropped_by_reason: resolved.report.dropped_by_reason,
        by_dimension: byDimension,
        taxonomy_seed_inserted: taxonomySeed.inserted,
        taxonomy_seed_skipped: taxonomySeed.skipped,
        total_assignments_ready: rows.length,
        total_assignments_inserted: writeResult.inserted,
        total_assignments_updated: writeResult.updated,
        taxonomy_tags_missing_before_dry_run: dryRun
          ? [...tagIdByKey.keys()].filter((key) => !persistedTagKeys.has(key))
              .length
          : 0,
        missing_taxonomy_tags: Object.fromEntries(missingTaxonomy.entries()),
      },
      null,
      2,
    ),
  );
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function taxonomyKey(
  dimension: CreativeTagDimension,
  valueKey: string,
): string {
  return `${dimension}:${valueKey}`;
}
