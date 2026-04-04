/**
 * GET  /api/auth/facebook-token — return stored Facebook provider_token for the current user (or null).
 * POST /api/auth/facebook-token — persist provider_token after OAuth callback (body: { providerToken: string }).
 *
 * On DB errors (missing table, RLS, etc.) GET returns HTTP 200 with `token: null` and a `diagnostic`
 * object so the client can still use localStorage and show a precise message — not a generic 500.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function logSupabaseError(context: string, err: { message: string; code?: string; details?: string; hint?: string }) {
  console.error(
    `[facebook-token ${context}]`,
    err.message,
    err.code ? `code=${err.code}` : "",
    err.details ? `details=${err.details}` : "",
    err.hint ? `hint=${err.hint}` : "",
  );
}

export async function GET() {
  console.info("[facebook-token GET] callback hit");

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.error("[facebook-token GET] getUser error:", userError.message);
    return NextResponse.json(
      {
        token: null,
        step: "auth_user",
        error: userError.message,
      },
      { status: 401 },
    );
  }

  if (!user) {
    console.warn("[facebook-token GET] no user session");
    return NextResponse.json({ token: null, step: "auth_user", error: "Not authenticated" }, { status: 401 });
  }

  console.info("[facebook-token GET] user", user.id);

  const { data, error } = await supabase
    .from("user_facebook_tokens")
    .select("provider_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    logSupabaseError("GET select", error);
    // Graceful: still 200 so fetch().ok — client falls back to localStorage / session
    return NextResponse.json({
      token: null,
      step: "database_read",
      diagnostic: {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        hintText:
          error.message?.includes("does not exist") || error.code === "42P01"
            ? "Apply supabase/migrations/002_user_facebook_tokens.sql to your project."
            : undefined,
      },
    });
  }

  const tok = data?.provider_token ?? null;
  console.info("[facebook-token GET] provider_token", tok ? `present (${tok.length} chars)` : "missing (no row)");

  return NextResponse.json({ token: tok, step: "ok" });
}

export async function POST(req: NextRequest) {
  console.info("[facebook-token POST] callback hit");

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error("[facebook-token POST] unauthenticated", userError?.message);
    return NextResponse.json(
      { ok: false, step: "auth_user", error: "Not authenticated" },
      { status: 401 },
    );
  }

  console.info("[facebook-token POST] user", user.id);

  let body: { providerToken?: string };
  try {
    body = (await req.json()) as { providerToken?: string };
  } catch {
    return NextResponse.json({ ok: false, step: "parse_body", error: "Invalid JSON" }, { status: 400 });
  }

  const providerToken = body.providerToken?.trim();
  if (!providerToken) {
    return NextResponse.json({ ok: false, step: "validate_token", error: "providerToken is required" }, { status: 400 });
  }

  console.info("[facebook-token POST] upserting token length", providerToken.length);

  const { error } = await supabase.from("user_facebook_tokens").upsert(
    {
      user_id: user.id,
      provider_token: providerToken,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    logSupabaseError("POST upsert", error);
    return NextResponse.json(
      {
        ok: false,
        step: "database_write",
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      },
      { status: 500 },
    );
  }

  console.info("[facebook-token POST] provider_token persisted successfully");
  return NextResponse.json({ ok: true, step: "ok" });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const { error } = await supabase.from("user_facebook_tokens").delete().eq("user_id", user.id);
  if (error) {
    logSupabaseError("DELETE", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
