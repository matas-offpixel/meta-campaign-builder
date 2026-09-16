/**
 * POST /api/tiktok/campaigns/import extracted so 400-before-write
 * can be driven without mocking `createClient`.
 */

import {
  listTikTokDrafts,
  upsertTikTokDraft,
} from "../../db/tiktok-drafts.ts";
import { fetchTikTokAdvertiserInfo } from "../advertiser.ts";
import { tikTokDuplicateExistingNames } from "../../tiktok-wizard/library.ts";
import {
  clientIdForTikTokAccount,
  credentialsForImportAdvertiser,
} from "./account.ts";
import {
  TIKTOK_IMPORT_ACCOUNT_NOT_LINKED,
  TIKTOK_IMPORT_EVENT_ID_CLIENT_MISMATCH,
  TIKTOK_IMPORT_EVENT_ID_REQUIRED,
  attachTikTokImportEvent,
  eventBelongsToClient,
  formatTikTokImportEventSuggestion,
  listTikTokImportEvents,
  loadTikTokImportEvent,
  parseTikTokImportEventId,
  suggestTikTokImportEvent,
  type TikTokImportEventOption,
  type TikTokImportEventRow,
} from "./event.ts";
import {
  buildTikTokImportPicker,
  classifyTikTokImportCarry,
  finalizeTikTokImportDraft,
  formatRejectedCarryKeys,
  mapTikTokLiveCampaignToDraft,
  parseTikTokImportCarry,
} from "./map.ts";
import { hydratePickerThumbnails } from "./picker.ts";
import { readTikTokLiveCampaign } from "./readers.ts";

type ImportSupabase = Parameters<typeof credentialsForImportAdvertiser>[0];

export type TikTokImportResult = {
  status: number;
  body: Record<string, unknown>;
};

export type TikTokImportBody = {
  advertiserId?: unknown;
  campaignId?: unknown;
  carry?: unknown;
  eventId?: unknown;
};

export type TikTokImportHandleDeps = {
  credentialsForAdvertiser?: typeof credentialsForImportAdvertiser;
  clientIdForAccount?: typeof clientIdForTikTokAccount;
  listEvents?: (
    supabase: ImportSupabase,
    args: { userId: string; clientId: string },
  ) => Promise<TikTokImportEventOption[]>;
  loadEvent?: (
    supabase: ImportSupabase,
    args: { eventId: string; userId: string },
  ) => Promise<TikTokImportEventRow | null>;
  readCampaign?: typeof readTikTokLiveCampaign;
  fetchAdvertiser?: typeof fetchTikTokAdvertiserInfo;
  listDrafts?: typeof listTikTokDrafts;
  upsertDraft?: typeof upsertTikTokDraft;
  hydrateThumbnails?: typeof hydratePickerThumbnails;
  /** Import/heal clock. Production uses wall-clock; tests pin it. */
  now?: Date;
};

export async function handleTikTokImport(input: {
  userId: string | null;
  body: TikTokImportBody;
  supabase: ImportSupabase;
  deps?: TikTokImportHandleDeps;
}): Promise<TikTokImportResult> {
  if (!input.userId) {
    return { status: 401, body: { ok: false, error: "Not signed in" } };
  }

  const advertiserId =
    typeof input.body.advertiserId === "string"
      ? input.body.advertiserId.trim()
      : "";
  const campaignId =
    typeof input.body.campaignId === "string"
      ? input.body.campaignId.trim()
      : "";
  if (!advertiserId || !campaignId) {
    return {
      status: 400,
      body: { ok: false, error: "advertiserId and campaignId are required" },
    };
  }

  const decision = parseTikTokImportCarry(input.body);
  if (decision.action === "nosave") {
    return {
      status: 200,
      body: { ok: true, saved: false, draft: null },
    };
  }

  const eventId = parseTikTokImportEventId(input.body);
  if (decision.action === "save" && !eventId) {
    return {
      status: 400,
      body: { ok: false, error: TIKTOK_IMPORT_EVENT_ID_REQUIRED },
    };
  }

  const deps = input.deps ?? {};
  const credentialsForAdvertiser =
    deps.credentialsForAdvertiser ?? credentialsForImportAdvertiser;
  const clientIdForAccount = deps.clientIdForAccount ?? clientIdForTikTokAccount;
  const listEvents = deps.listEvents ?? listTikTokImportEvents;
  const loadEvent = deps.loadEvent ?? loadTikTokImportEvent;
  const readCampaign = deps.readCampaign ?? readTikTokLiveCampaign;
  const fetchAdvertiser = deps.fetchAdvertiser ?? fetchTikTokAdvertiserInfo;
  const listDrafts = deps.listDrafts ?? listTikTokDrafts;
  const upsertDraft = deps.upsertDraft ?? upsertTikTokDraft;
  const hydrateThumbnails = deps.hydrateThumbnails ?? hydratePickerThumbnails;

  const credentials = await credentialsForAdvertiser(input.supabase, {
    userId: input.userId,
    advertiserId,
  });
  if ("error" in credentials) {
    return {
      status: credentials.status,
      body: { ok: false, error: credentials.error },
    };
  }

  const clientId = await clientIdForAccount(input.supabase, {
    userId: input.userId,
    tiktokAccountId: credentials.accountId,
  });

  let verifiedEvent: TikTokImportEventRow | null = null;
  if (decision.action === "save") {
    if (!clientId) {
      return {
        status: 400,
        body: { ok: false, error: TIKTOK_IMPORT_ACCOUNT_NOT_LINKED },
      };
    }
    const event = await loadEvent(input.supabase, {
      eventId: eventId!,
      userId: input.userId,
    });
    if (!eventBelongsToClient(event, clientId)) {
      return {
        status: 400,
        body: { ok: false, error: TIKTOK_IMPORT_EVENT_ID_CLIENT_MISMATCH },
      };
    }
    verifiedEvent = event;
  }

  try {
    const [bundle, advertiser] = await Promise.all([
      readCampaign({
        advertiserId,
        campaignId,
        token: credentials.token,
      }),
      fetchAdvertiser({
        advertiserId,
        token: credentials.token,
      }),
    ]);

    if (decision.action === "picker") {
      const picker = buildTikTokImportPicker(bundle);
      const rows = await hydrateThumbnails({
        rows: picker.rows,
        advertiserId,
        token: credentials.token,
      });
      if (!clientId) {
        return {
          status: 200,
          body: {
            ok: true,
            saved: false,
            picker: { ...picker, rows },
            clientId: null,
            events: [],
            suggestedEventId: null,
            suggestedEventLabel: null,
            accountUnlinked: true,
            error: TIKTOK_IMPORT_ACCOUNT_NOT_LINKED,
          },
        };
      }
      const events = await listEvents(input.supabase, {
        userId: input.userId,
        clientId,
      });
      const suggestion = suggestTikTokImportEvent(
        picker.campaign.name,
        events,
      );
      return {
        status: 200,
        body: {
          ok: true,
          saved: false,
          picker: { ...picker, rows },
          clientId,
          events,
          suggestedEventId: suggestion?.eventId ?? null,
          suggestedEventLabel: suggestion
            ? formatTikTokImportEventSuggestion(suggestion.code)
            : null,
        },
      };
    }

    // Save already returned 400 unless verifiedEvent is set; picker
    // returned above. TypeScript cannot see that, so this is the
    // not-found path rather than a mismatch.
    if (!verifiedEvent) {
      return {
        status: 400,
        body: { ok: false, error: TIKTOK_IMPORT_EVENT_ID_REQUIRED },
      };
    }

    const picker = buildTikTokImportPicker(bundle);
    const { accepted, rejected } = classifyTikTokImportCarry(
      picker,
      decision.carry,
    );
    if (accepted.length === 0) {
      return {
        status: 200,
        body: {
          ok: true,
          saved: false,
          draft: null,
          rejected,
          error: formatRejectedCarryKeys(rejected),
        },
      };
    }
    const mappedId = crypto.randomUUID();
    const mapped = mapTikTokLiveCampaignToDraft(bundle, mappedId, {
      tiktokAccountId: credentials.accountId,
      advertiserId,
      currency: advertiser.currency,
      timezone: advertiser.timezone,
    }, { carry: accepted });
    if (mapped.creatives.items.length === 0) {
      return {
        status: 200,
        body: {
          ok: true,
          saved: false,
          draft: null,
          rejected,
          error:
            rejected.length > 0
              ? formatRejectedCarryKeys(rejected)
              : "Nothing was saved.",
        },
      };
    }
    mapped.clientId = clientId;
    const visible = await listDrafts(input.supabase, { userId: input.userId });
    const draftId = crypto.randomUUID();
    const draft = attachTikTokImportEvent(
      finalizeTikTokImportDraft(
        mapped,
        draftId,
        tikTokDuplicateExistingNames(mapped, visible),
        deps.now ?? new Date(),
      ),
      verifiedEvent,
    );
    const saved = await upsertDraft(input.supabase, draftId, {
      ...draft,
      userId: input.userId,
    });
    return {
      status: 200,
      body: { ok: true, saved: true, draft: saved },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tiktok/campaigns/import] failed:", message);
    return {
      status: 200,
      body: { ok: false, error: message || "TikTok import failed" },
    };
  }
}
