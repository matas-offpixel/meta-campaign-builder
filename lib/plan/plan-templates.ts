import { isRelationMissing } from "./schema-probe.ts";
import type { CampaignPlanTemplate, CampaignPlanTemplateSnapshot } from "./library.ts";

export function rowToPlanTemplate(row: {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  tags?: string[] | null;
  snapshot_json: CampaignPlanTemplateSnapshot;
  created_at: string;
  updated_at: string;
}): CampaignPlanTemplate {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? "",
    tags: row.tags ?? [],
    snapshot: row.snapshot_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type TemplateClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        order: (
          col: string,
          opts: { ascending: boolean },
        ) => Promise<{
          data: Parameters<typeof rowToPlanTemplate>[0][] | null;
          error: { code?: string; message?: string } | null;
        }>;
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{
            data: Parameters<typeof rowToPlanTemplate>[0] | null;
            error: { code?: string; message?: string } | null;
          }>;
        };
      };
    };
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        maybeSingle: () => Promise<{
          data: Parameters<typeof rowToPlanTemplate>[0] | null;
          error: { code?: string; message?: string } | null;
        }>;
      };
    };
    delete: () => {
      eq: (col: string, value: string) => {
        eq: (col: string, value: string) => Promise<{
          error: { code?: string; message?: string } | null;
        }>;
      };
    };
  };
};

export async function loadPlanTemplatesForUser(
  supabase: unknown,
  userId: string,
): Promise<
  | { ok: true; templates: CampaignPlanTemplate[]; tableMissing: false }
  | { ok: true; templates: []; tableMissing: true }
  | { ok: false; error: string; tableMissing: boolean }
> {
  const client = supabase as TemplateClient;
  const { data, error } = await client
    .from("campaign_plan_templates")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (!error) {
    return {
      ok: true,
      templates: (data ?? []).map(rowToPlanTemplate),
      tableMissing: false,
    };
  }
  if (isRelationMissing(error)) {
    return { ok: true, templates: [], tableMissing: true };
  }
  return { ok: false, error: error.message ?? "template load failed", tableMissing: false };
}

export async function insertPlanTemplate(
  supabase: unknown,
  input: {
    userId: string;
    name: string;
    description: string;
    tags: string[];
    snapshot: CampaignPlanTemplateSnapshot;
  },
): Promise<
  | { ok: true; template: CampaignPlanTemplate }
  | { ok: false; tableMissing: boolean; error: string }
> {
  const client = supabase as TemplateClient;
  const { data, error } = await client
    .from("campaign_plan_templates")
    .insert({
      user_id: input.userId,
      name: input.name,
      description: input.description,
      tags: input.tags,
      snapshot_json: input.snapshot,
    })
    .select("*")
    .maybeSingle();
  if (!error && data) return { ok: true, template: rowToPlanTemplate(data) };
  return {
    ok: false,
    tableMissing: isRelationMissing(error),
    error: error?.message ?? "template insert failed",
  };
}

export async function loadPlanTemplateForUser(
  supabase: unknown,
  id: string,
  userId: string,
): Promise<CampaignPlanTemplate | null> {
  const client = supabase as TemplateClient;
  const { data, error } = await client
    .from("campaign_plan_templates")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToPlanTemplate(data);
}

export async function deletePlanTemplateForUser(
  supabase: unknown,
  id: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; tableMissing: boolean; error: string }> {
  const client = supabase as TemplateClient;
  const { error } = await client
    .from("campaign_plan_templates")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (!error) return { ok: true };
  return {
    ok: false,
    tableMissing: isRelationMissing(error),
    error: error.message ?? "template delete failed",
  };
}
