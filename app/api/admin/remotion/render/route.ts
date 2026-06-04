import { NextResponse, type NextRequest } from "next/server";

import { getCreativeProvider } from "@/lib/creatives/registry";
import {
  REMOTION_TEMPLATE_ID,
} from "@/lib/creatives/remotion/provider";
import {
  isRemotionEnabled,
  type CreativeTemplate,
  type ProviderTemplateSummary,
} from "@/lib/creatives/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface RenderRequestBody {
  templateId?: unknown;
  fields?: unknown;
}

function toCreativeTemplate(
  summary: ProviderTemplateSummary,
  userId: string,
): CreativeTemplate {
  const now = new Date().toISOString();
  return {
    id: summary.externalTemplateId,
    user_id: userId,
    name: summary.name,
    provider: "remotion",
    external_template_id: summary.externalTemplateId,
    fields_jsonb: summary.fields ?? [],
    channel: summary.channel ?? "feed",
    aspect_ratios: summary.aspectRatios ?? ["1:1"],
    notes: null,
    created_at: now,
    updated_at: now,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  if (!isRemotionEnabled()) {
    return NextResponse.json(
      {
        error:
          "FEATURE_REMOTION is off — enable it in environment variables to run renders.",
      },
      { status: 503 },
    );
  }

  let body: RenderRequestBody;
  try {
    body = (await req.json()) as RenderRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const templateId =
    typeof body.templateId === "string" ? body.templateId.trim() : "";
  if (!templateId) {
    return NextResponse.json({ error: "Missing templateId" }, { status: 400 });
  }

  if (
    body.fields === null ||
    typeof body.fields !== "object" ||
    Array.isArray(body.fields)
  ) {
    return NextResponse.json({ error: "Missing fields object" }, { status: 400 });
  }

  const fields = body.fields as Record<string, unknown>;

  try {
    const remotion = getCreativeProvider("remotion");
    const summaries = await remotion.listTemplates();
    const summary = summaries.find(
      (t) => t.externalTemplateId === templateId,
    );

    if (!summary) {
      return NextResponse.json(
        { error: `Unknown templateId "${templateId}"` },
        { status: 404 },
      );
    }

    const template = toCreativeTemplate(summary, user.id);
    const { jobId } = await remotion.render(template, fields);
    const polled = await remotion.pollRender(jobId);

    if (polled.status !== "done" || !polled.assetUrl) {
      return NextResponse.json(
        {
          error: polled.errorMessage ?? "Render failed",
          jobId,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      jobId,
      assetUrl: polled.assetUrl,
      templateId: REMOTION_TEMPLATE_ID,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
