import { NextRequest, NextResponse } from "next/server";

import {
  createInterestCluster,
  listInterestClusters,
  loadClientVertical,
  updateInterestCluster,
  type ClusterResult,
  type InterestClusterPatch,
} from "@/lib/db/interest-clusters";
import { effectiveClientVertical, normaliseClusterInterests } from "@/lib/interest-clusters";
import { createClient } from "@/lib/supabase/server";

async function sessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function unauthorised() {
  return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
}

function fail<T>(result: Extract<ClusterResult<T>, { ok: false }>) {
  return NextResponse.json(
    { ok: false, error: result.error, tableMissing: result.tableMissing ?? false, existing: result.existing },
    { status: result.status },
  );
}

/** All of the user's clusters (archived included) plus the vertical of `?clientId`. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { supabase, user } = await sessionUser();
  if (!user) return unauthorised();
  const clientId = req.nextUrl.searchParams.get("clientId");
  const [listed, vertical] = await Promise.all([
    listInterestClusters(supabase, user.id),
    clientId ? loadClientVertical(supabase, user.id, clientId) : Promise.resolve(null),
  ]);
  if (!listed.ok) return fail(listed);
  return NextResponse.json({ ok: true, clusters: listed.value, vertical });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { supabase, user } = await sessionUser();
  if (!user) return unauthorised();
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; interests?: unknown; clientId?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const interests = normaliseClusterInterests(body.interests);
  if (!name || interests.length === 0) {
    return NextResponse.json({ ok: false, error: "name and at least one interest are required" }, { status: 400 });
  }
  const vertical = effectiveClientVertical(
    typeof body.clientId === "string" && body.clientId ? await loadClientVertical(supabase, user.id, body.clientId) : null,
  );
  const result = await createInterestCluster(supabase, user.id, { name, vertical, interests });
  if (!result.ok) return fail(result);
  return NextResponse.json({ ok: true, cluster: result.value });
}

/** Rename, archive / unarchive, or replace the interest set. No delete. */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { supabase, user } = await sessionUser();
  if (!user) return unauthorised();
  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    name?: unknown;
    archived?: unknown;
    interests?: unknown;
  };
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }
  const patch: InterestClusterPatch = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ ok: false, error: "name cannot be empty" }, { status: 400 });
    patch.name = name;
  }
  if (typeof body.archived === "boolean") patch.archived = body.archived;
  if (body.interests !== undefined) {
    const interests = normaliseClusterInterests(body.interests);
    if (!interests.length) {
      return NextResponse.json({ ok: false, error: "interests cannot be empty" }, { status: 400 });
    }
    patch.interests = interests;
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ ok: false, error: "nothing to update" }, { status: 400 });
  }
  const result = await updateInterestCluster(supabase, user.id, body.id, patch);
  if (!result.ok) return fail(result);
  return NextResponse.json({ ok: true, cluster: result.value });
}
