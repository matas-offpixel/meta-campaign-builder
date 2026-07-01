/**
 * app/api/admin/d2c/bird-templates/route.ts
 *
 * Admin trigger for programmatic Bird Studio template creation. Same flow as
 * the CLI (`scripts/d2c/ship-bird-templates.ts`), gated by EITHER a Matas
 * session (MATAS_USER_IDS) OR an `Authorization: Bearer <CRON_SECRET>` header.
 *
 * POST body (application/json):
 *   { brand: string, dryRun?: boolean, locales?: string[],
 *     templates?: string[], submit?: boolean, attachChannelGroup?: boolean }
 *
 * Reads Bird credentials from env (BIRD_API_KEY / BIRD_WORKSPACE_ID) — the same
 * long-lived AccessKey the D2C cron uses. Templates are created as drafts.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import { shipBrandTemplates, type ShipOptions } from "@/lib/d2c/bird/templates/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_WORKSPACE_ID = "9c308f77-c5ed-44d3-9714-9da017c7536c";

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

function parseBody(body: unknown): { brand: string; opts: ShipOptions } | { error: string } {
  if (!body || typeof body !== "object") return { error: "JSON body required." };
  const b = body as Record<string, unknown>;
  if (typeof b.brand !== "string" || !b.brand.trim()) return { error: "brand is required." };
  const asStrArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : undefined;
  return {
    brand: b.brand.trim(),
    opts: {
      dryRun: b.dryRun === true,
      submit: b.submit === true,
      attachChannelGroup: b.attachChannelGroup !== false,
      locales: asStrArr(b.locales),
      templateNames: asStrArr(b.templates),
    },
  };
}

export async function POST(req: NextRequest) {
  const authorized = hasCronBearer(req) || (await hasMatasSession());
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.BIRD_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "BIRD_API_KEY not configured on the server." },
      { status: 500 },
    );
  }
  const workspaceId = process.env.BIRD_WORKSPACE_ID?.trim() || DEFAULT_WORKSPACE_ID;

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

  try {
    const report = await shipBrandTemplates({ apiKey, workspaceId }, parsed.brand, parsed.opts);
    const errors = report.results.filter((r) => r.outcome === "error").length;
    return NextResponse.json(report, { status: errors ? 207 : 200 });
  } catch (e) {
    const err = e as { message?: string; code?: string };
    return NextResponse.json(
      { error: err?.message ?? "ship failed", code: err?.code ?? "BIRD_TPL_ERROR" },
      { status: 502 },
    );
  }
}
