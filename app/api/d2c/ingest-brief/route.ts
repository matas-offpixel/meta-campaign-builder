/**
 * POST /api/d2c/ingest-brief
 *
 * Accepts either:
 *   - multipart/form-data: fields `client_id` + `file` (a PDF brief), or
 *   - application/json:     { client_id, brief_text } for the manual path.
 *
 * Inserts a d2c_brief_ingest_jobs row (status=pending) and kicks off background
 * processing via Next.js `after()`. Returns the job id immediately; the UI
 * polls GET /api/d2c/ingest-brief/[id] for status.
 */

import { after, NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { insertBriefIngestJob } from "@/lib/db/d2c";
import { processBriefIngestJob } from "@/lib/d2c/brief-parser/processor";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB — Anthropic document cap territory.

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";

  let clientId: string | null = null;
  let pdfBuffer: Buffer | null = null;
  let briefText: string | undefined;
  let source: "pdf" | "manual" = "manual";
  let sourceUri: string | null = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      clientId = (form.get("client_id") as string | null)?.trim() || null;
      const file = form.get("file");
      if (file && typeof file !== "string") {
        const blob = file as File;
        if (blob.size > MAX_PDF_BYTES) {
          return NextResponse.json(
            { ok: false, error: "PDF exceeds the 25 MB limit." },
            { status: 400 },
          );
        }
        pdfBuffer = Buffer.from(await blob.arrayBuffer());
        source = "pdf";
        sourceUri = blob.name || "brief.pdf";
      }
      const manualText = form.get("brief_text");
      if (typeof manualText === "string" && manualText.trim()) {
        briefText = manualText;
        if (!pdfBuffer) source = "manual";
      }
    } else {
      const body = (await req.json()) as {
        client_id?: string;
        brief_text?: string;
      };
      clientId = body.client_id?.trim() || null;
      briefText = body.brief_text;
      source = "manual";
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not read request body." },
      { status: 400 },
    );
  }

  if (!clientId) {
    return NextResponse.json(
      { ok: false, error: "client_id is required." },
      { status: 400 },
    );
  }
  if (!pdfBuffer && (!briefText || !briefText.trim())) {
    return NextResponse.json(
      { ok: false, error: "Provide a PDF file or brief_text." },
      { status: 400 },
    );
  }

  // Ownership check.
  const { data: client } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) {
    return NextResponse.json({ ok: false, error: "Client not found" }, { status: 404 });
  }
  if (client.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const job = await insertBriefIngestJob(supabase, {
    userId: user.id,
    clientId,
    source,
    sourceUri,
  });
  if (!job) {
    return NextResponse.json(
      { ok: false, error: "Failed to create ingest job." },
      { status: 500 },
    );
  }

  // Background processing — service role so it can write the event + sends.
  after(async () => {
    try {
      const service = createServiceRoleClient();
      await processBriefIngestJob(service, job.id, {
        pdfBuffer,
        briefText,
      });
    } catch (e) {
      console.error("[ingest-brief] background processing threw", e);
    }
  });

  return NextResponse.json({ ok: true, job });
}
