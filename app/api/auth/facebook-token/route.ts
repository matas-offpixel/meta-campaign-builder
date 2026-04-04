/**
 * GET  /api/auth/facebook-token — return stored Facebook provider_token for the current user (or null).
 * POST /api/auth/facebook-token — persist provider_token after OAuth callback (body: { providerToken: string }).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_facebook_tokens")
    .select("provider_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[facebook-token GET]", error.message);
    return NextResponse.json({ error: "Failed to load token" }, { status: 500 });
  }

  return NextResponse.json({ token: data?.provider_token ?? null });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let body: { providerToken?: string };
  try {
    body = (await req.json()) as { providerToken?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const providerToken = body.providerToken?.trim();
  if (!providerToken) {
    return NextResponse.json({ error: "providerToken is required" }, { status: 400 });
  }

  const { error } = await supabase.from("user_facebook_tokens").upsert(
    {
      user_id: user.id,
      provider_token: providerToken,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("[facebook-token POST]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  await supabase.from("user_facebook_tokens").delete().eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}
