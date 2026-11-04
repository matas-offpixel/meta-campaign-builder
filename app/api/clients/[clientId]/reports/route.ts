import { NextResponse, type NextRequest } from "next/server";

import { SEASON_REPORT_MAX_BYTES } from "@/lib/client-reports/access";
import { ClientReportError, createOwnedClientReport } from "@/lib/db/client-reports";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireOwnedClient(clientId: string): Promise<NextResponse | null> {
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
    { ok: false, error: "Could not save the report." },
    { status: 500 },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params;
  if (!UUID.test(clientId)) {
    return NextResponse.json(
      { ok: false, error: "client id must be a uuid" },
      { status: 400 },
    );
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
  const season = form.get("season");
  const title = form.get("title");
  if (!(file instanceof File) || typeof season !== "string" || typeof title !== "string") {
    return NextResponse.json(
      { ok: false, error: "Upload an .html file with a season and a title." },
      { status: 400 },
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const report = await createOwnedClientReport({
      clientId,
      season,
      title,
      filename: file.name,
      bytes,
    });
    return NextResponse.json({ ok: true, report }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
