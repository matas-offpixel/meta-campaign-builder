/**
 * POST /api/storage/ensure-bucket
 *
 * Verifies that the given Supabase Storage bucket exists and creates it if not.
 * Requires SUPABASE_SERVICE_ROLE_KEY to be set in environment variables.
 *
 * Called automatically by the client when a storage upload fails with
 * "Bucket not found". Returns { exists: true } if the bucket is confirmed
 * accessible, { created: true } if it was just created, or an error object.
 */

import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const BUCKET_NAME = "campaign-assets";
const BUCKET_FILE_SIZE_LIMIT = 200 * 1024 * 1024; // 200 MB
const BUCKET_ALLOWED_MIME = ["video/mp4", "video/quicktime", "video/webm", "image/jpeg", "image/png"];

export async function POST(): Promise<NextResponse> {
  // Auth gate — only authenticated users can call this
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.info(
    `[ensure-bucket] project=${supabaseUrl} bucket=${BUCKET_NAME}`,
    serviceRoleKey ? "(service role key present)" : "(⚠ SUPABASE_SERVICE_ROLE_KEY not set)",
  );

  // ── Check bucket existence via anon client first ───────────────────────────
  const { data: bucketData, error: bucketCheckError } = await supabase.storage.getBucket(BUCKET_NAME);

  if (bucketData && !bucketCheckError) {
    console.info(`[ensure-bucket] bucket "${BUCKET_NAME}" already exists`);
    return NextResponse.json({ exists: true, bucketName: BUCKET_NAME });
  }

  console.warn(
    `[ensure-bucket] bucket check result: exists=${!!bucketData} error="${bucketCheckError?.message}"`,
  );

  // ── Attempt creation with service role key ─────────────────────────────────
  if (!serviceRoleKey || !supabaseUrl) {
    const msg = !serviceRoleKey
      ? `SUPABASE_SERVICE_ROLE_KEY is not configured. ` +
        `To fix: run the SQL in supabase/schema.sql in the Supabase SQL editor, ` +
        `OR add SUPABASE_SERVICE_ROLE_KEY to your environment variables so this route can auto-create the bucket.`
      : "NEXT_PUBLIC_SUPABASE_URL is not configured";
    console.error(`[ensure-bucket] ${msg}`);
    return NextResponse.json({ error: msg, bucketName: BUCKET_NAME }, { status: 500 });
  }

  const adminClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error: createError } = await adminClient.storage.createBucket(BUCKET_NAME, {
    public: false,
    fileSizeLimit: BUCKET_FILE_SIZE_LIMIT,
    allowedMimeTypes: BUCKET_ALLOWED_MIME,
  });

  if (createError) {
    // "already exists" is fine — treat it as success
    if (createError.message?.toLowerCase().includes("already exist")) {
      console.info(`[ensure-bucket] bucket already exists (confirmed via create attempt)`);
      return NextResponse.json({ exists: true, bucketName: BUCKET_NAME });
    }
    console.error("[ensure-bucket] failed to create bucket:", createError);
    return NextResponse.json(
      { error: `Failed to create bucket: ${createError.message}`, bucketName: BUCKET_NAME },
      { status: 500 },
    );
  }

  console.info(`[ensure-bucket] bucket "${BUCKET_NAME}" created successfully`);
  return NextResponse.json({ created: true, bucketName: BUCKET_NAME });
}
