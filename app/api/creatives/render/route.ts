import { NextResponse, type NextRequest } from "next/server";

import { getBannerbearProvider } from "@/lib/creatives/bannerbear/provider";
import { CreativeProviderDisabledError } from "@/lib/creatives/types";
import { assertBannerbearAllowed } from "@/lib/creatives/guard";
import { getCreativeTemplateById } from "@/lib/db/creative-templates";
import { createClient } from "@/lib/supabase/server";

type PostBody = {
  template_id?: unknown;
  event_id?: unknown;
  client_id?: unknown;
  fields?: unknown;
};

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const templateId = typeof body.template_id === "string" ? body.template_id : "";
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  if (!isUuidLike(templateId) || !isUuidLike(clientId)) {
    return NextResponse.json(
      { error: "template_id and client_id are required UUIDs" },
      { status: 400 },
    );
  }

  let eventId: string | null = null;
  if (body.event_id !== null && body.event_id !== undefined) {
    if (typeof body.event_id === "string" && isUuidLike(body.event_id)) {
      eventId = body.event_id;
    } else {
      return NextResponse.json(
        { error: "event_id must be a valid UUID or null" },
        { status: 400 },
      );
    }
  }

  if (!body.fields || typeof body.fields !== "object" || Array.isArray(body.fields)) {
    return NextResponse.json(
      { error: "fields must be a JSON object" },
      { status: 400 },
    );
  }
  const fields = body.fields as Record<string, unknown>;

  try {
    await assertBannerbearAllowed(supabase, clientId);
  } catch (e) {
    if (e instanceof CreativeProviderDisabledError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }

  const template = await getCreativeTemplateById(supabase, templateId);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  if (template.provider !== "bannerbear") {
    return NextResponse.json(
      { error: "Template provider must be bannerbear" },
      { status: 400 },
    );
  }
  if (!template.external_template_id) {
    return NextResponse.json(
      { error: "Template is missing external_template_id" },
      { status: 400 },
    );
  }

  if (eventId) {
    const { data: ev, error: evError } = await supabase
      .from("events")
      .select("id, client_id")
      .eq("id", eventId)
      .maybeSingle();
    if (evError) {
      return NextResponse.json(
        { error: `Event lookup failed: ${evError.message}` },
        { status: 500 },
      );
    }
    if (!ev) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (ev.client_id !== clientId) {
      return NextResponse.json(
        { error: "Event does not belong to this client" },
        { status: 400 },
      );
    }
  }

  let provider;
  try {
    provider = getBannerbearProvider();
  } catch (e) {
    if (e instanceof CreativeProviderDisabledError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    throw e;
  }

  const { data: ins, error: insError } = await supabase
    .from("creative_renders")
    .insert({
      user_id: user.id,
      event_id: eventId,
      template_id: templateId,
      status: "queued",
      fields_jsonb: fields,
      provider_job_id: null,
      asset_url: null,
      error_message: null,
    })
    .select("id, status, provider_job_id")
    .single();

  if (insError || !ins) {
    return NextResponse.json(
      { error: insError?.message ?? "Insert failed" },
      { status: 500 },
    );
  }
  const renderId = ins.id as string;

  try {
    const job = await provider.render(template, fields);
    const { error: upError } = await supabase
      .from("creative_renders")
      .update({
        status: "rendering",
        provider_job_id: job.jobId,
        error_message: null,
      })
      .eq("id", renderId)
      .eq("user_id", user.id);
    if (upError) {
      return NextResponse.json({ error: upError.message }, { status: 500 });
    }
    return NextResponse.json({
      render_id: renderId,
      status: "rendering" as const,
      provider_job_id: job.jobId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase
      .from("creative_renders")
      .update({
        status: "failed",
        error_message: message.slice(0, 2000),
      })
      .eq("id", renderId)
      .eq("user_id", user.id);
    if (e instanceof CreativeProviderDisabledError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
