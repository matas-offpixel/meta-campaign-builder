/**
 * app/api/admin/d2c/mailchimp-templates/route.ts
 *
 * Admin trigger for programmatic Mailchimp template creation. Mirror of
 * app/api/admin/d2c/bird-templates/route.ts. Gated by EITHER a Matas session
 * (MATAS_USER_IDS) OR `Authorization: Bearer <CRON_SECRET>`.
 *
 * POST body (application/json):
 *   { brand: string, clientId?: string, dryRun?: boolean,
 *     templates?: string[], apiKeyEnvVar?: string }
 *
 * Credentials resolve from d2c_connections (client_id, provider='mailchimp')
 * with an env-var fallback for local dev (see lib/d2c/mailchimp/credentials.ts).
 */

import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import { resolveMailchimpCredentials } from "@/lib/d2c/mailchimp/credentials";
import { shipMailchimpTemplates } from "@/lib/d2c/mailchimp/templates/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function hasCronBearer(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : header.trim();
  return token.length > 0 && token === expected;
}

async function hasMatasSession(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return !!user && isD2CApprover(user.id);
  } catch {
    return false;
  }
}

interface ParsedBody {
  brand: string;
  clientId?: string;
  dryRun: boolean;
  templateNames?: string[];
  apiKeyEnvVar?: string;
}

function parseBody(body: unknown): ParsedBody | { error: string } {
  if (!body || typeof body !== "object") return { error: "JSON body required." };
  const b = body as Record<string, unknown>;
  if (typeof b.brand !== "string" || !b.brand.trim()) return { error: "brand is required." };
  const asStrArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : undefined;
  return {
    brand: b.brand.trim(),
    clientId: typeof b.clientId === "string" && b.clientId.trim() ? b.clientId.trim() : undefined,
    dryRun: b.dryRun === true,
    templateNames: asStrArr(b.templates),
    apiKeyEnvVar: typeof b.apiKeyEnvVar === "string" ? b.apiKeyEnvVar.trim() : undefined,
  };
}

export async function POST(req: NextRequest) {
  const authorized = hasCronBearer(req) || (await hasMatasSession());
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = parseBody(json);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  let supabase: ReturnType<typeof createServiceRoleClient> | null = null;
  try {
    supabase = createServiceRoleClient();
  } catch {
    supabase = null;
  }

  const creds = await resolveMailchimpCredentials({
    supabase,
    clientId: parsed.clientId,
    envVarName: parsed.apiKeyEnvVar,
  });
  if (!creds) {
    return NextResponse.json(
      { error: "No Mailchimp credentials for this client (no d2c_connections row and no env fallback)." },
      { status: 400 },
    );
  }

  try {
    const report = await shipMailchimpTemplates(
      { serverPrefix: creds.serverPrefix, apiKey: creds.apiKey },
      parsed.brand,
      { dryRun: parsed.dryRun, templateNames: parsed.templateNames },
    );
    const errors = report.results.filter((r) => r.outcome === "error" || r.outcome === "invalid").length;
    return NextResponse.json({ ...report, credentialSource: creds.source }, { status: errors ? 207 : 200 });
  } catch (e) {
    const err = e as { message?: string; status?: number };
    return NextResponse.json(
      { error: err?.message ?? "ship failed", code: err?.status ? `MC_HTTP_${err.status}` : "MC_TPL_ERROR" },
      { status: 502 },
    );
  }
}
