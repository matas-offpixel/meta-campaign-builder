import { NextResponse, type NextRequest } from "next/server";

import { parseSeasonReportExpiry, SEASON_REPORT_MAX_BYTES } from "@/lib/client-reports/access";
import {
  ClientReportError,
  replaceOwnedClientReportFile,
  updateOwnedClientReport,
} from "@/lib/db/client-reports";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireOwnedClient(clientId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: "Client not found or not yours" },
      { status: 403 },
    );
  }
  return null;
}

function jsonError(err: unknown) {
  if (err instanceof ClientReportError) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: err.status },
    );
  }
  console.error("[client-reports]", err);
  return NextResponse.json(
    { ok: false, error: "Could not update the report." },
    { status: 500 },
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> },
) {
  // [id], not [clientId]. See the create route.
  const { id: clientId, reportId } = await params;
  if (!UUID.test(clientId) || !UUID.test(reportId)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  const denied = await requireOwnedClient(clientId);
  if (denied) return denied;

  let body: {
    enabled?: unknown;
    expires_at?: unknown;
    regenerate?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const patch: {
    clientId: string;
    reportId: string;
    enabled?: boolean;
    expiresAt?: string | null;
    regenerate?: boolean;
  } = { clientId, reportId };

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "enabled must be true or false" },
        { status: 400 },
      );
    }
    patch.enabled = body.enabled;
  }
  if (body.expires_at !== undefined) {
    const expiry = parseSeasonReportExpiry(body.expires_at);
    if (!expiry.ok) {
      return NextResponse.json({ ok: false, error: expiry.error }, { status: 400 });
    }
    patch.expiresAt = expiry.expiresAt;
  }
  if (body.regenerate === true) patch.regenerate = true;

  try {
    const report = await updateOwnedClientReport(patch);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> },
) {
  const { id: clientId, reportId } = await params;
  if (!UUID.test(clientId) || !UUID.test(reportId)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  const denied = await requireOwnedClient(clientId);
  if (denied) return denied;

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > SEASON_REPORT_MAX_BYTES + 16_384) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `This report is too large to host. The limit is ${SEASON_REPORT_MAX_BYTES} bytes (4.5 MB). ` +
          "Vercel Functions cap the response at 4.5 MB, and streaming does not raise that cap, so the file was not saved.",
      },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Expected a form upload." },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Upload an .html file." },
      { status: 400 },
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const report = await replaceOwnedClientReportFile({
      clientId,
      reportId,
      filename: file.name,
      bytes,
    });
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    return jsonError(err);
  }
}
