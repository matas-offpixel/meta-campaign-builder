import { NextResponse, type NextRequest } from "next/server";

import { getBannerbearProvider } from "@/lib/creatives/bannerbear/provider";
import { CreativeProviderDisabledError } from "@/lib/creatives/types";
import {
  getCreativeRenderById,
  getCreativeTemplateById,
} from "@/lib/db/creative-templates";
import { createClient } from "@/lib/supabase/server";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteCtx) {
  const { id: renderId } = await context.params;
  if (!renderId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const row = await getCreativeRenderById(supabase, renderId);
  if (!row) {
    return NextResponse.json({ error: "Render not found" }, { status: 404 });
  }

  if (row.status === "done" || row.status === "failed") {
    return NextResponse.json({ render: row });
  }

  const template = await getCreativeTemplateById(supabase, row.template_id);
  if (!template) {
    return NextResponse.json(
      { error: "Template missing for this render" },
      { status: 404 },
    );
  }
  if (template.provider !== "bannerbear" || !row.provider_job_id) {
    return NextResponse.json({ render: row });
  }

  let provider;
  try {
    provider = getBannerbearProvider();
  } catch (e) {
    if (e instanceof CreativeProviderDisabledError) {
      return NextResponse.json(
        { error: e.message, render: row },
        { status: 503 },
      );
    }
    throw e;
  }

  try {
    const job = await provider.pollRender(row.provider_job_id);
    const { error: upError } = await supabase
      .from("creative_renders")
      .update({
        status: job.status,
        asset_url: job.assetUrl ?? null,
        error_message: job.errorMessage ?? null,
      })
      .eq("id", renderId)
      .eq("user_id", user.id);

    if (upError) {
      return NextResponse.json(
        { error: upError.message, render: row },
        { status: 500 },
      );
    }

    const next = await getCreativeRenderById(supabase, renderId);
    return NextResponse.json({ render: next ?? row });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: message, render: row },
      { status: 500 },
    );
  }
}
