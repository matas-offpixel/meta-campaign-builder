import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { listAudiences, MailchimpApiError } from "@/lib/mailchimp/client";
import { getMailchimpCredentials } from "@/lib/mailchimp/credentials";

/**
 * GET /api/integrations/mailchimp/audiences
 *
 * Returns all Mailchimp audiences available to the current user's first
 * connected Mailchimp account. Used by the client overview audience picker.
 *
 * Never returns the API key — only audience id/name/stats.
 */
export async function GET() {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data: accounts, error: accountsError } = await sb
    .from("mailchimp_accounts")
    .select("id, account_name, mailchimp_dc")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (accountsError) {
    return NextResponse.json(
      { ok: false, error: accountsError.message },
      { status: 500 },
    );
  }

  const account = (
    accounts as Array<{ id: string; account_name: string; mailchimp_dc: string }>
  )[0];
  if (!account) {
    return NextResponse.json({ ok: true, audiences: [] });
  }

  let credentials;
  try {
    credentials = await getMailchimpCredentials(supabase, account.id);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to load Mailchimp credentials." },
      { status: 500 },
    );
  }
  if (!credentials) {
    return NextResponse.json({ ok: true, audiences: [] });
  }

  try {
    const result = await listAudiences(credentials.dc, credentials.apiKey);
    return NextResponse.json({
      ok: true,
      accountId: account.id,
      accountName: account.account_name,
      audiences: result.lists.map((l) => ({
        id: l.id,
        name: l.name,
        memberCount: l.stats.member_count,
      })),
    });
  } catch (err) {
    const message =
      err instanceof MailchimpApiError ? err.message : "Mailchimp API error.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
