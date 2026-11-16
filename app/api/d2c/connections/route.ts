import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  listD2CConnectionsForUser,
  upsertD2CConnection,
} from "@/lib/db/d2c";
import { getD2CProvider, listD2CProviderNames } from "@/lib/d2c/registry";
import { saveD2CConnection } from "@/lib/d2c/connections/save";
import { MissingD2CTokenKeyError } from "@/lib/d2c/secrets";

/**
 * /api/d2c/connections
 *
 * GET ?clientId=X            → list D2C connections for this user.
 * POST { clientId, provider, credentials }
 *                              → validate credentials with the provider, then
 *                                 upsert. Bad credentials → 400; nothing is
 *                                 written to the DB on failure. Credentials
 *                                 are always redacted on response.
 *                                 Bird needs a UUID workspace_id, and a
 *                                 workspace on another client's active Bird
 *                                 connection is refused (409). Logic:
 *                                 lib/d2c/connections/save.ts.
 *
 * Mirrors the ticketing connections route surface.
 */

const ALLOWED_PROVIDERS = listD2CProviderNames();

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  const connections = await listD2CConnectionsForUser(supabase, {
    clientId: clientId || null,
  });

  return NextResponse.json({
    ok: true,
    connections: connections.map((c) => ({ ...c, credentials: null })),
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  try {
    const result = await saveD2CConnection(
      {
        async findClient(clientId) {
          const { data, error } = await supabase
            .from("clients")
            .select("id")
            .eq("id", clientId)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return (data as { id: string } | null) ?? null;
        },
        validate: (provider, credentials) =>
          getD2CProvider(provider).validateCredentials(credentials),
        // Service role: a workspace saved by any user would split the
        // nightly ingest. Reads ids and names only, never credentials.
        async findBirdWorkspaceOwners(workspaceId) {
          const admin = createServiceRoleClient();
          const { data, error } = await admin
            .from("d2c_connections")
            .select("client_id")
            .eq("provider", "bird")
            .eq("status", "active")
            .ilike("external_account_id", workspaceId);
          if (error) throw new Error(error.message);
          const ids = [
            ...new Set(
              ((data ?? []) as { client_id: string }[]).map((r) => r.client_id),
            ),
          ];
          if (ids.length === 0) return [];
          const { data: clients } = await admin
            .from("clients")
            .select("id, name")
            .in("id", ids);
          const names = new Map(
            ((clients ?? []) as { id: string; name: string | null }[]).map(
              (c) => [c.id, c.name],
            ),
          );
          return ids.map((id) => ({
            client_id: id,
            client_name: names.get(id) ?? null,
          }));
        },
        upsert: (input) =>
          upsertD2CConnection(supabase, { userId: user.id, ...input }),
      },
      { body, allowedProviders: ALLOWED_PROVIDERS },
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof MissingD2CTokenKeyError) {
      return NextResponse.json(
        { ok: false, error: e.message },
        { status: 500 },
      );
    }
    throw e;
  }
}
