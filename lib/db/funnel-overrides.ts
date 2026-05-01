import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventFunnelOverride } from "@/lib/dashboard/funnel-aggregations";

type FunnelOverrideScope =
  | { kind: "event"; clientId: string; eventId: string }
  | { kind: "venue"; clientId: string; eventCode: string };

const OVERRIDE_FIELDS =
  "tofu_to_mofu_rate, mofu_to_bofu_rate, bofu_to_reg_rate, reg_to_sale_rate, organic_lift_rate, cost_per_reach, cost_per_lpv, cost_per_reg, sellout_target_override";

export async function getFunnelOverride(
  supabase: SupabaseClient,
  scope: FunnelOverrideScope,
): Promise<EventFunnelOverride | null> {
  let query = db(supabase)
    .from("event_funnel_overrides")
    .select(OVERRIDE_FIELDS)
    .eq("client_id", scope.clientId);

  query =
    scope.kind === "event"
      ? query.eq("event_id", scope.eventId)
      : query.eq("event_code", scope.eventCode);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? rowToOverride(data) : null;
}

export async function upsertFunnelOverride(
  supabase: SupabaseClient,
  scope: FunnelOverrideScope,
  override: EventFunnelOverride,
): Promise<EventFunnelOverride> {
  const payload = {
    client_id: scope.clientId,
    event_id: scope.kind === "event" ? scope.eventId : null,
    event_code: scope.kind === "venue" ? scope.eventCode : null,
    ...override,
  };

  let existingQuery = db(supabase)
    .from("event_funnel_overrides")
    .select("id")
    .eq("client_id", scope.clientId);
  existingQuery =
    scope.kind === "event"
      ? existingQuery.eq("event_id", scope.eventId)
      : existingQuery.eq("event_code", scope.eventCode);
  const existing = await existingQuery.maybeSingle();
  if (existing.error) throw existing.error;

  const writer = existing.data?.id
    ? db(supabase)
        .from("event_funnel_overrides")
        .update(payload)
        .eq("id", String(existing.data.id))
    : db(supabase).from("event_funnel_overrides").insert(payload);

  const { data, error } = await writer.select(OVERRIDE_FIELDS).single();
  if (error) throw error;
  if (!data) throw new Error("Funnel override write returned no row");
  return rowToOverride(data);
}

export function parseFunnelOverrideInput(input: unknown): EventFunnelOverride {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    tofu_to_mofu_rate: optionalNumber(body.tofu_to_mofu_rate),
    mofu_to_bofu_rate: optionalNumber(body.mofu_to_bofu_rate),
    bofu_to_reg_rate: optionalNumber(body.bofu_to_reg_rate),
    reg_to_sale_rate: optionalNumber(body.reg_to_sale_rate),
    organic_lift_rate: optionalNumber(body.organic_lift_rate),
    cost_per_reach: optionalNumber(body.cost_per_reach),
    cost_per_lpv: optionalNumber(body.cost_per_lpv),
    cost_per_reg: optionalNumber(body.cost_per_reg),
    sellout_target_override: optionalInteger(body.sellout_target_override),
  };
}

function rowToOverride(row: Record<string, unknown>): EventFunnelOverride {
  return parseFunnelOverrideInput(row);
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function optionalInteger(value: unknown): number | null {
  const n = optionalNumber(value);
  return n == null ? null : Math.round(n);
}

function db(supabase: SupabaseClient) {
  return supabase as unknown as {
    from(table: "event_funnel_overrides"): {
      select(fields: string): QueryBuilder;
      insert(value: Record<string, unknown>): WriteBuilder;
      update(value: Record<string, unknown>): MutateBuilder;
    };
  };
}

interface QueryBuilder {
  eq(column: string, value: string): QueryBuilder;
  maybeSingle(): Promise<QueryResult>;
}

interface WriteBuilder {
  select(fields: string): { single(): Promise<QueryResult> };
}

interface MutateBuilder extends WriteBuilder {
  eq(column: string, value: string): MutateBuilder;
}

interface QueryResult {
  data: Record<string, unknown> | null;
  error: Error | null;
}
