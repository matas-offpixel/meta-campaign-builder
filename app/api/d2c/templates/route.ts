import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  listD2CTemplatesForUser,
  upsertD2CTemplate,
} from "@/lib/db/d2c";
import type { D2CChannel } from "@/lib/d2c/types";

/**
 * /api/d2c/templates
 *
 * GET ?clientId=X&channel=email
 *                      → list templates for the current user.
 * POST { id?, clientId, name, channel, subject?, bodyMarkdown, variablesJsonb? }
 *                      → upsert a template.
 */

const VALID_CHANNELS: D2CChannel[] = ["email", "sms", "whatsapp"];

interface PostBody {
  id?: unknown;
  clientId?: unknown;
  name?: unknown;
  channel?: unknown;
  subject?: unknown;
  bodyMarkdown?: unknown;
  variablesJsonb?: unknown;
}

function extractVariables(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v : null))
    .filter((v): v is string => v !== null);
}

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
  const sp = req.nextUrl.searchParams;
  const clientIdParam = sp.get("clientId");
  const channelParam = sp.get("channel") as D2CChannel | null;

  const templates = await listD2CTemplatesForUser(supabase, {
    clientId: clientIdParam ?? undefined,
    channel:
      channelParam && VALID_CHANNELS.includes(channelParam)
        ? channelParam
        : null,
  });
  return NextResponse.json({ ok: true, templates });
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
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const channel = body.channel as D2CChannel | undefined;
  const bodyMarkdown =
    typeof body.bodyMarkdown === "string" ? body.bodyMarkdown : "";
  const subject =
    typeof body.subject === "string" ? body.subject : null;
  const clientId =
    typeof body.clientId === "string" && body.clientId.trim()
      ? body.clientId.trim()
      : null;
  const id = typeof body.id === "string" ? body.id : undefined;

  if (!name) {
    return NextResponse.json(
      { ok: false, error: "name is required" },
      { status: 400 },
    );
  }
  if (!channel || !VALID_CHANNELS.includes(channel)) {
    return NextResponse.json(
      {
        ok: false,
        error: `channel must be one of: ${VALID_CHANNELS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const template = await upsertD2CTemplate(supabase, {
    id,
    userId: user.id,
    clientId,
    name,
    channel,
    subject,
    bodyMarkdown,
    variablesJsonb: extractVariables(body.variablesJsonb),
  });
  if (!template) {
    return NextResponse.json(
      { ok: false, error: "Failed to persist template" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, template }, { status: 201 });
}
