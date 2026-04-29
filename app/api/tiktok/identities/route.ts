import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getTikTokCredentials } from "@/lib/tiktok/credentials";
import { fetchTikTokIdentities } from "@/lib/tiktok/identity";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const advertiserId = req.nextUrl.searchParams.get("advertiser_id");
  if (!advertiserId) {
    return NextResponse.json(
      { ok: false, error: "Missing advertiser_id query param" },
      { status: 400 },
    );
  }

  const account = await readTikTokAccountByAdvertiser(supabase, {
    userId: user.id,
    advertiserId,
  });
  if (!account) {
    return NextResponse.json(
      { ok: false, error: "TikTok advertiser not found" },
      { status: 404 },
    );
  }

  try {
    const credentials = await getTikTokCredentials(supabase, account.id);
    if (!credentials?.access_token) {
      return NextResponse.json(
        { ok: false, error: "TikTok credentials missing" },
        { status: 400 },
      );
    }
    const identities = await fetchTikTokIdentities({
      advertiserId,
      token: credentials.access_token,
    });
    return NextResponse.json({ ok: true, identities }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[tiktok/identities] read failed:", message);
    return NextResponse.json(
      { ok: false, error: message, identities: [] },
      { status: 200 },
    );
  }
}

async function readTikTokAccountByAdvertiser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: { userId: string; advertiserId: string },
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("tiktok_accounts")
    .select("id")
    .eq("user_id", args.userId)
    .eq("tiktok_advertiser_id", args.advertiserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string } | null;
}
