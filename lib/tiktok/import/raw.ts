import { isOperator } from "../../auth/operator-allowlist.ts";
import { credentialsForImportAdvertiser } from "./account.ts";
import { readTikTokLiveCampaign } from "./readers.ts";
import { recordingTikTokGet } from "./record.ts";

type RawSupabase = Parameters<typeof credentialsForImportAdvertiser>[0];

export type TikTokImportRawResult = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * The raw capture handler, extracted so 401 / 403 can be driven
 * through the same function the route calls, without mocking
 * `createClient`.
 */
export async function handleTikTokImportRaw(input: {
  advertiserId: string | null;
  campaignId: string | null;
  userId: string | null;
  supabase: RawSupabase;
}): Promise<TikTokImportRawResult> {
  if (!input.userId) {
    return { status: 401, body: { ok: false, error: "Not signed in" } };
  }
  if (!isOperator(input.userId)) {
    return { status: 403, body: { ok: false, error: "Not permitted" } };
  }

  const advertiserId = input.advertiserId?.trim() || null;
  const campaignId = input.campaignId?.trim() || null;
  if (!advertiserId || !campaignId) {
    return {
      status: 400,
      body: { ok: false, error: "advertiserId and campaignId are required" },
    };
  }

  const credentials = await credentialsForImportAdvertiser(input.supabase, {
    userId: input.userId,
    advertiserId,
  });
  if ("error" in credentials) {
    return {
      status: credentials.status,
      body: { ok: false, error: credentials.error },
    };
  }

  const { request, calls } = recordingTikTokGet();
  let readError: string | null = null;
  try {
    await readTikTokLiveCampaign({
      advertiserId,
      campaignId,
      token: credentials.token,
      request,
    });
  } catch (err) {
    readError = err instanceof Error ? err.message : String(err);
  }

  return {
    status: 200,
    body: {
      ok: readError == null,
      advertiserId,
      campaignId,
      capturedAt: new Date().toISOString(),
      note: "`data` is verbatim. The outer envelope (code, message, request_id) is only present on `error` because lib/tiktok/client.ts unwraps a code-0 response before this recorder sees it.",
      readError,
      calls,
    },
  };
}
