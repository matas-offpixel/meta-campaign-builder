/**
 * POST /api/internal-counts/upload — "Upload count PDF" on the review list.
 *
 * The backstop if Gmail is ever disconnected: the same parser, checks and
 * writes as the pull. The message id is upload:{pdf sha256}, so uploading
 * the same file twice writes 0 rows. Operator session only.
 */

import { NextResponse, type NextRequest } from "next/server";

import { loadRunContext } from "@/lib/internal-counts/context";
import { readPdf } from "@/lib/internal-counts/pdf-read";
import { processMessageSafely } from "@/lib/internal-counts/store";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;

function back(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL("/internal-counts", req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return back(req, { upload: "no_file" });
  if (file.size > MAX_BYTES) return back(req, { upload: "too_large" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") return back(req, { upload: "not_pdf" });

  const sb = createServiceRoleClient();
  const pdf = await readPdf(file.name, bytes);
  const now = new Date().toISOString();
  const result = await processMessageSafely(sb, await loadRunContext(sb), {
    userId: user.id,
    source: "upload",
    kind: pdf.verdict === "sheet" ? "count" : "unreadable",
    threadId: null,
    messageId: `upload:${pdf.sha256}`,
    sentAt: now,
    forward: false,
    receivedAt: now,
    sender: user.email ?? null,
    subject: `Uploaded: ${file.name}`,
    body: "",
    pdf,
  });
  let first: string | null = null;
  if (result.status === "already_read" || result.status === "duplicate") {
    const { data } = await sb
      .from("internal_count_reports")
      .select("received_at")
      .eq("pdf_sha256", pdf.sha256)
      .order("received_at", { ascending: true })
      .limit(1);
    first = ((data ?? [])[0] as { received_at?: string } | undefined)?.received_at ?? null;
  }
  return back(req, {
    upload: result.status,
    file: file.name,
    written: String(result.blocksWritten),
    held: String(result.blocksHeld),
    ...(first ? { first } : {}),
  });
}
