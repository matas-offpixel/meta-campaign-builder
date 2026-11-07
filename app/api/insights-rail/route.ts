/**
 * GET /api/insights-rail — the Insights rail's data for one page.
 *
 * Operator-only (requireOperator): the rail is never on a client surface
 * (rule 12), and the readers behind it are the cross-client module's.
 * Reads only. The page's context comes in the query; the Lab summary
 * comes in the body-less `lab` param as JSON, because the event page
 * already holds it.
 */

import { NextResponse, type NextRequest } from "next/server";

import { railData, requireOperator } from "@/lib/learning/cross-client";
import type { RailContext, RailLab, RailScope, RailStage, RailSurface } from "@/lib/insights-rail/model";

export const dynamic = "force-dynamic";

const SURFACES = new Set<RailSurface>(["event", "campaign", "audience", "page"]);
const SCOPES = new Set<RailScope>(["client", "vertical", "all"]);
const STAGES = new Set<RailStage>(["registration", "ticket_sale"]);

function text(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

function parseLab(value: string | null): RailLab | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as RailLab;
    if (!parsed || typeof parsed.roundNo !== "number" || !Array.isArray(parsed.ads)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const operator = await requireOperator();
  if (!operator.ok) return operator.response;
  const q = req.nextUrl.searchParams;
  const surface = q.get("surface") as RailSurface | null;
  const scope = q.get("scope") as RailScope | null;
  const stage = q.get("stage") as RailStage | null;
  if (!surface || !SURFACES.has(surface)) return NextResponse.json({ error: "surface" }, { status: 400 });
  if (!scope || !SCOPES.has(scope)) return NextResponse.json({ error: "scope" }, { status: 400 });
  if (!stage || !STAGES.has(stage)) return NextResponse.json({ error: "stage" }, { status: 400 });
  const context: RailContext = {
    surface,
    title: text(q.get("title")) ?? "",
    clientId: text(q.get("clientId")),
    clientName: operator.context.seesClientNames ? text(q.get("clientName")) : null,
    verticalId: text(q.get("verticalId")),
    eventId: text(q.get("eventId")),
    stage,
    objective: text(q.get("objective")),
    lab: parseLab(q.get("lab")),
  };
  try {
    const data = await railData(operator.context, { context, scope, stage });
    return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read the insights.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
