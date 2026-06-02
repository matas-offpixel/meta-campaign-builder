import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  extractDc,
  getAccountInfo,
  pingMailchimp,
  MailchimpApiError,
} from "@/lib/mailchimp/client";
import { setMailchimpCredentials } from "@/lib/mailchimp/credentials";

/**
 * POST /api/integrations/mailchimp/connect
 *
 * Body: { apiKey: string; accountLabel?: string }
 *
 * 1. Validates the key via /ping.
 * 2. Derives dc + loginId from the root / endpoint.
 * 3. Inserts a mailchimp_accounts row.
 * 4. Encrypts credentials in place via set_mailchimp_credentials().
 *
 * DELETE /api/integrations/mailchimp/connect
 *
 * Body: { accountId: string }
 *
 * Nulls out clients.mailchimp_account_id for all clients linked to this
 * account, then deletes the mailchimp_accounts row.
 */

export async function POST(req: NextRequest) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Body must be a JSON object." },
      { status: 400 },
    );
  }
  const { apiKey, accountLabel } = body as Record<string, unknown>;
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return NextResponse.json(
      { ok: false, error: "apiKey is required." },
      { status: 400 },
    );
  }

  let dc: string;
  try {
    dc = extractDc(apiKey.trim());
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "Cannot parse API key format.",
      },
      { status: 400 },
    );
  }

  // Validate credentials are live.
  try {
    await pingMailchimp(dc, apiKey.trim());
  } catch (err) {
    const message =
      err instanceof MailchimpApiError
        ? err.message
        : "Mailchimp ping failed.";
    return NextResponse.json(
      { ok: false, error: `Invalid API key: ${message}` },
      { status: 422 },
    );
  }

  // Derive login id + account name from root endpoint.
  let loginId: string | null = null;
  let derivedAccountName: string | null = null;
  try {
    const info = await getAccountInfo(dc, apiKey.trim());
    loginId = info.login_id ?? null;
    derivedAccountName = info.account_name ?? null;
  } catch {
    // Non-fatal — we still have dc from the key suffix.
  }

  const resolvedLabel =
    typeof accountLabel === "string" && accountLabel.trim()
      ? accountLabel.trim()
      : (derivedAccountName ?? "Mailchimp Account");

  // Insert row (without credentials — encrypt below).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data: inserted, error: insertError } = await sb
    .from("mailchimp_accounts")
    .insert({
      user_id: user.id,
      account_name: resolvedLabel,
      mailchimp_dc: dc,
      mailchimp_login_id: loginId,
    })
    .select("id")
    .single();

  if (insertError) {
    return NextResponse.json(
      { ok: false, error: insertError.message },
      { status: 500 },
    );
  }

  const accountId = (inserted as { id: string }).id;

  // Encrypt credentials in place.
  try {
    await setMailchimpCredentials(supabase, accountId, {
      apiKey: apiKey.trim(),
      dc,
      loginId,
      accountName: resolvedLabel,
    });
  } catch (err) {
    // Best-effort cleanup — if encryption fails, delete the inserted row.
    await sb.from("mailchimp_accounts").delete().eq("id", accountId);
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to encrypt credentials.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      accountId,
      accountName: resolvedLabel,
      dc,
    },
    { status: 201 },
  );
}

export async function DELETE(req: NextRequest) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const { accountId } = (body ?? {}) as Record<string, unknown>;
  if (typeof accountId !== "string" || !accountId.trim()) {
    return NextResponse.json(
      { ok: false, error: "accountId is required." },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  // Ownership check.
  const { data: existing } = await sb
    .from("mailchimp_accounts")
    .select("id, user_id")
    .eq("id", accountId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Account not found." },
      { status: 404 },
    );
  }
  if ((existing as { user_id: string }).user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden." },
      { status: 403 },
    );
  }

  // Null out the FK on clients before deleting.
  await sb
    .from("clients")
    .update({ mailchimp_account_id: null })
    .eq("mailchimp_account_id", accountId)
    .eq("user_id", user.id);

  const { error: deleteError } = await sb
    .from("mailchimp_accounts")
    .delete()
    .eq("id", accountId)
    .eq("user_id", user.id);

  if (deleteError) {
    return NextResponse.json(
      { ok: false, error: deleteError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
