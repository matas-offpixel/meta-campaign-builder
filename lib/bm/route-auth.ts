import "server-only";

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { MATAS_USER_IDS } from "@/lib/auth/operator-allowlist";

/**
 * Gate for the Business Manager tool API routes.
 *
 * Requires a cookie-bound Supabase session AND membership of the operator
 * allowlist (the tool acts as Matas's personal Meta identity — only operators
 * may drive it). Returns the authenticated user + session client on success, or
 * a ready-to-return NextResponse on failure.
 */
export async function requireOperator(): Promise<
  | { ok: true; user: User; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 }),
    };
  }
  if (!MATAS_USER_IDS.includes(user.id)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Operator access required" }, { status: 403 }),
    };
  }
  return { ok: true, user, supabase };
}
