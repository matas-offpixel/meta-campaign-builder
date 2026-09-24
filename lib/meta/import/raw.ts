import { graphGetWithToken, graphPostWithToken } from "../client.ts";
import { facebookTokenForImport } from "./account.ts";
import { recordingMetaGraph } from "./record.ts";
import { readMetaLiveCampaign } from "./readers.ts";
import { guardMetaImportRaw } from "./raw-guard.ts";

type RawSupabase = Parameters<typeof facebookTokenForImport>[0];

export type MetaImportRawResult = {
  status: number;
  body: Record<string, unknown>;
};

function graphRequest() {
  return {
    get: graphGetWithToken,
    post: graphPostWithToken,
  };
}

/**
 * The raw capture handler. 401 / 403 / 400 live in `raw-guard.ts` so
 * tests can drive them without importing `lib/meta/client.ts`.
 */
export async function handleMetaImportRaw(input: {
  adAccountId: string | null;
  campaignId: string | null;
  userId: string | null;
  supabase: RawSupabase;
}): Promise<MetaImportRawResult> {
  const guard = guardMetaImportRaw(input);
  if (!guard.ok) {
    return { status: guard.status, body: { ok: false, error: guard.error } };
  }

  const credentials = await facebookTokenForImport(input.supabase, input.userId!);
  if ("error" in credentials) {
    return {
      status: credentials.status,
      body: { ok: false, error: credentials.error },
    };
  }

  const { request, calls } = recordingMetaGraph(graphRequest());
  let readError: string | null = null;
  try {
    await readMetaLiveCampaign({
      adAccountId: guard.adAccountId,
      campaignId: guard.campaignId,
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
      adAccountId: guard.adAccountId,
      campaignId: guard.campaignId,
      capturedAt: new Date().toISOString(),
      note: "`data` is verbatim Graph. Creative hydration is POST / Batch API (Graph v26.0 removed GET /?ids=), using CREATIVE_BATCH_FIELDS. No mapping.",
      readError,
      calls,
    },
  };
}
