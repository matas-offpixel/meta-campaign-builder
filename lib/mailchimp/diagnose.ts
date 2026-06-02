import type { SupabaseClient } from "@supabase/supabase-js";

import { getAudience, getAudienceListActivity, MailchimpApiError } from "./client.ts";
import { getMailchimpCredentials, requireMailchimpTokenKey } from "./credentials.ts";
import { resolveMailchimpAudienceId } from "./activity-reconstruct.ts";

export interface MailchimpDiagnoseResult {
  ok: boolean;
  audienceId: string | null;
  audienceSource: "event_override" | "client_default" | "none";
  mailchimpAccountId: string | null;
  tokenKeyConfigured: boolean;
  credentialsPresent: boolean;
  credentialsDecryptOk: boolean;
  apiPingOk: boolean;
  activityRowsSample: Array<{ day: string; subs: number; unsubs: number }>;
  snapshotRowCount: number;
  error?: string;
}

interface DiagnoseEventRow {
  id: string;
  mailchimp_audience_id: string | null;
  client:
    | { mailchimp_account_id: string | null; mailchimp_audience_id: string | null }
    | { mailchimp_account_id: string | null; mailchimp_audience_id: string | null }[]
    | null;
}

function audienceSource(
  event: DiagnoseEventRow,
  resolvedId: string | null,
): MailchimpDiagnoseResult["audienceSource"] {
  if (!resolvedId) return "none";
  if (event.mailchimp_audience_id) return "event_override";
  return "client_default";
}

/**
 * Read-only Mailchimp connection diagnostic for a single event.
 * Never returns API keys or decrypted credentials.
 */
export async function diagnoseMailchimpForEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  event: DiagnoseEventRow,
): Promise<MailchimpDiagnoseResult> {
  const audienceId = resolveMailchimpAudienceId(event);
  const client = Array.isArray(event.client) ? event.client[0] : event.client;
  const accountId = client?.mailchimp_account_id ?? null;

  let tokenKeyConfigured = false;
  try {
    requireMailchimpTokenKey();
    tokenKeyConfigured = true;
  } catch {
    tokenKeyConfigured = false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { count: snapshotRowCount } = await sb
    .from("mailchimp_audience_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("event_id", event.id);

  const base: MailchimpDiagnoseResult = {
    ok: false,
    audienceId,
    audienceSource: audienceSource(event, audienceId),
    mailchimpAccountId: accountId,
    tokenKeyConfigured,
    credentialsPresent: false,
    credentialsDecryptOk: false,
    apiPingOk: false,
    activityRowsSample: [],
    snapshotRowCount: snapshotRowCount ?? 0,
  };

  if (!audienceId) {
    return { ...base, error: "no_audience_id" };
  }
  if (!accountId) {
    return { ...base, error: "no_account_id — connect Mailchimp at /settings/mailchimp" };
  }
  if (!tokenKeyConfigured) {
    return { ...base, error: "MAILCHIMP_TOKEN_KEY not configured on server" };
  }

  const { data: accountRow } = await sb
    .from("mailchimp_accounts")
    .select("id, credentials_encrypted")
    .eq("id", accountId)
    .maybeSingle();

  const hasEncrypted =
    accountRow != null &&
    typeof (accountRow as { credentials_encrypted?: unknown }).credentials_encrypted ===
      "string" &&
    String((accountRow as { credentials_encrypted: string }).credentials_encrypted).length > 0;

  if (!hasEncrypted) {
    return {
      ...base,
      credentialsPresent: false,
      error: "mailchimp_accounts row missing credentials_encrypted — re-connect at /settings/mailchimp",
    };
  }

  let credentials;
  try {
    credentials = await getMailchimpCredentials(supabase, accountId);
  } catch (err) {
    return {
      ...base,
      credentialsPresent: true,
      credentialsDecryptOk: false,
      error: `credentials_decrypt_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!credentials) {
    return {
      ...base,
      credentialsPresent: true,
      credentialsDecryptOk: false,
      error: "credentials_decrypt_returned_null",
    };
  }

  try {
    await getAudience(credentials.dc, audienceId, credentials.apiKey);
  } catch (err) {
    return {
      ...base,
      credentialsPresent: true,
      credentialsDecryptOk: true,
      apiPingOk: false,
      error: `api_audience_failed: ${err instanceof MailchimpApiError ? err.message : String(err)}`,
    };
  }

  let activityRowsSample: MailchimpDiagnoseResult["activityRowsSample"] = [];
  try {
    const activity = await getAudienceListActivity(
      credentials.apiKey,
      credentials.dc,
      audienceId,
      5,
    );
    activityRowsSample = activity.slice(-5).map((row) => ({
      day: row.day,
      subs: row.subs,
      unsubs: row.unsubs,
    }));
  } catch (err) {
    return {
      ...base,
      credentialsPresent: true,
      credentialsDecryptOk: true,
      apiPingOk: true,
      activityRowsSample: [],
      error: `api_activity_failed: ${err instanceof MailchimpApiError ? err.message : String(err)}`,
    };
  }

  return {
    ...base,
    ok: true,
    credentialsPresent: true,
    credentialsDecryptOk: true,
    apiPingOk: true,
    activityRowsSample,
  };
}
