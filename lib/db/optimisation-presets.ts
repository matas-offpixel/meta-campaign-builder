import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ClientOptimisationPreset,
  type PresetArm,
  type PresetGuardrails,
  type PresetRule,
} from "@/lib/optimisation/presets";
import type { CampaignObjective, OptimisationStrategyMode } from "@/lib/types";

/**
 * CRUD for `client_optimisation_presets` (migration 165).
 *
 * Reads are additive-safe: until the migration is applied the table is
 * absent and every read returns `[]`, which `resolvePreset` turns into the
 * industry seed. Nothing breaks in the window between merge and apply.
 *
 * The decision logic lives in `lib/optimisation/presets.ts` — this file only
 * moves rows across the wire.
 */

export interface OptimisationPresetRow {
  id: string;
  user_id: string;
  client_id: string;
  objective: string;
  version: number;
  default_arm: string;
  mode: string;
  rules: unknown;
  guardrails: unknown;
  created_at: string | null;
  updated_at: string | null;
}

const SELECT =
  "id, user_id, client_id, objective, version, default_arm, mode, rules, guardrails, created_at, updated_at";

export function presetTableMissing(
  error: { code?: string; message?: string } | null,
): boolean {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    message.includes("client_optimisation_presets")
  );
}

const OBJECTIVES: readonly CampaignObjective[] = [
  "purchase",
  "registration",
  "traffic",
  "awareness",
  "engagement",
];

const MODES: readonly OptimisationStrategyMode[] = ["none", "benchmarks", "custom"];

export function isCampaignObjective(value: unknown): value is CampaignObjective {
  return typeof value === "string" && (OBJECTIVES as readonly string[]).includes(value);
}

/**
 * Row → domain. Defensive because `rules` / `guardrails` are jsonb: a row
 * written by the backfill script or by hand must not be able to crash a
 * render. Anything unreadable degrades to an empty ladder, which
 * `materialiseStrategy` renders as "no bands" rather than inventing one.
 */
export function mapPresetRow(row: OptimisationPresetRow): ClientOptimisationPreset {
  return {
    id: row.id,
    clientId: row.client_id,
    objective: isCampaignObjective(row.objective) ? row.objective : "registration",
    version: typeof row.version === "number" ? row.version : 1,
    defaultArm: row.default_arm === "shadow" ? "shadow" : "off",
    mode: (MODES as readonly string[]).includes(row.mode)
      ? (row.mode as OptimisationStrategyMode)
      : "benchmarks",
    rules: Array.isArray(row.rules) ? (row.rules as PresetRule[]) : [],
    guardrails:
      row.guardrails && typeof row.guardrails === "object"
        ? (row.guardrails as PresetGuardrails)
        : { maxExpansionPercent: 100, ceilingBehaviour: "stop" },
    updatedAt: row.updated_at,
  };
}

export async function listPresetsForClient(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientOptimisationPreset[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("client_optimisation_presets")
    .select(SELECT)
    .eq("client_id", clientId);

  if (error) {
    if (!presetTableMissing(error)) {
      console.warn("[optimisation-presets] read failed", error.message);
    }
    return [];
  }
  return ((data ?? []) as OptimisationPresetRow[]).map(mapPresetRow);
}

export interface SavePresetInput {
  clientId: string;
  objective: CampaignObjective;
  defaultArm: PresetArm;
  mode: OptimisationStrategyMode;
  rules: PresetRule[];
  guardrails: PresetGuardrails;
}

/**
 * Save = bump the version.
 *
 * `UNIQUE (client_id, objective)` means one live row per client × objective,
 * so a save is an upsert that increments `version` rather than an insert of
 * a second row. The immutable record of what version N contained is the
 * materialised `optimisationStrategy` on each campaign that used it — see
 * the migration header.
 */
export async function savePreset(
  supabase: SupabaseClient,
  userId: string,
  input: SavePresetInput,
): Promise<
  | { ok: true; preset: ClientOptimisationPreset }
  | { ok: false; error: string; migrationMissing: boolean }
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;

  const { data: existing, error: readError } = await client
    .from("client_optimisation_presets")
    .select("id, version")
    .eq("client_id", input.clientId)
    .eq("objective", input.objective)
    .maybeSingle();

  if (readError && !presetTableMissing(readError)) {
    return { ok: false, error: readError.message, migrationMissing: false };
  }
  if (readError) {
    return { ok: false, error: readError.message, migrationMissing: true };
  }

  const payload = {
    user_id: userId,
    client_id: input.clientId,
    objective: input.objective,
    version: ((existing?.version as number | undefined) ?? 0) + 1,
    default_arm: input.defaultArm,
    mode: input.mode,
    rules: input.rules,
    guardrails: input.guardrails,
  };

  const query = existing?.id
    ? client
        .from("client_optimisation_presets")
        .update(payload)
        .eq("id", existing.id)
        .select(SELECT)
        .single()
    : client
        .from("client_optimisation_presets")
        .insert(payload)
        .select(SELECT)
        .single();

  const { data, error } = await query;
  if (error) {
    return {
      ok: false,
      error: error.message,
      migrationMissing: presetTableMissing(error),
    };
  }
  return { ok: true, preset: mapPresetRow(data as OptimisationPresetRow) };
}

export async function deletePreset(
  supabase: SupabaseClient,
  clientId: string,
  objective: CampaignObjective,
): Promise<{ ok: boolean; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("client_optimisation_presets")
    .delete()
    .eq("client_id", clientId)
    .eq("objective", objective);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Objectives this client actually runs, from their campaign drafts. The
 * `/clients/[id]` Optimisation section renders one card per objective
 * present here, so an operator is never asked to write policy for a
 * campaign shape they have never launched.
 */
export async function listObjectivesForClient(
  supabase: SupabaseClient,
  clientId: string,
): Promise<CampaignObjective[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("campaign_drafts")
    .select("draft_json")
    .eq("client_id", clientId)
    .limit(500);

  if (error) {
    console.warn("[optimisation-presets] objective scan failed", error.message);
    return [];
  }

  const seen = new Set<CampaignObjective>();
  for (const row of (data ?? []) as Array<{ draft_json?: unknown }>) {
    const objective = (
      row.draft_json as { settings?: { objective?: unknown } } | null
    )?.settings?.objective;
    if (isCampaignObjective(objective)) seen.add(objective);
  }
  return OBJECTIVES.filter((o) => seen.has(o));
}
