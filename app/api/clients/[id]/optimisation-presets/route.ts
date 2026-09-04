import { NextResponse } from "next/server";

import {
  isCampaignObjective,
  listPresetsForClient,
  savePreset,
} from "@/lib/db/optimisation-presets";
import type { PresetGuardrails, PresetRule } from "@/lib/optimisation/presets";
import { createClient } from "@/lib/supabase/server";
import type { OptimisationStrategyMode } from "@/lib/types";

/**
 * Client × objective optimisation presets.
 *
 * GET  → every preset this client has.
 * PUT  → save one (bumps `version`; one live row per client × objective).
 *
 * Session + client ownership, same shape as the funnel-benchmarks route.
 * Nothing here can arm live writes: `default_arm` accepts `off` / `shadow`
 * only and the per-campaign live gate is untouched.
 */

async function authorise(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };

  const { data: client, error } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !client || client.user_id !== user.id) {
    return { error: NextResponse.json({ ok: false, error: "Not found" }, { status: 404 }) };
  }
  return { supabase, userId: user.id };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  const presets = await listPresetsForClient(auth.supabase, id);
  return NextResponse.json({ ok: true, presets });
}

interface SaveBody {
  objective?: unknown;
  defaultArm?: unknown;
  mode?: unknown;
  rules?: unknown;
  guardrails?: unknown;
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorise(id);
  if ("error" in auth) return auth.error;

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!isCampaignObjective(body.objective)) {
    return NextResponse.json(
      { ok: false, error: "objective must be one of purchase|registration|traffic|awareness|engagement" },
      { status: 400 },
    );
  }
  // `live` is rejected rather than coerced: a preset that silently downgraded
  // a live request would read as if it had been accepted.
  if (body.defaultArm !== "off" && body.defaultArm !== "shadow") {
    return NextResponse.json(
      { ok: false, error: "defaultArm must be off or shadow — live stays a per-campaign gate" },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.rules)) {
    return NextResponse.json({ ok: false, error: "rules must be an array" }, { status: 400 });
  }
  if (!body.guardrails || typeof body.guardrails !== "object") {
    return NextResponse.json({ ok: false, error: "guardrails must be an object" }, { status: 400 });
  }

  const mode: OptimisationStrategyMode =
    body.mode === "none" || body.mode === "custom" ? body.mode : "benchmarks";

  const result = await savePreset(auth.supabase, auth.userId, {
    clientId: id,
    objective: body.objective,
    defaultArm: body.defaultArm,
    mode,
    rules: body.rules as PresetRule[],
    guardrails: body.guardrails as PresetGuardrails,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, migrationMissing: result.migrationMissing },
      { status: result.migrationMissing ? 503 : 500 },
    );
  }
  return NextResponse.json({ ok: true, preset: result.preset });
}
