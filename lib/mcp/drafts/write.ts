/**
 * lib/mcp/drafts/write.ts
 *
 * The one place the MCP writes campaign_drafts (M2, scope mcp:draft).
 *
 *   - Only rows with status 'draft' are changed. A published or archived
 *     draft is read-only here (live changes are M3); a tool aimed at one
 *     gets a plain refusal.
 *   - Every change is guarded on updated_at (optimistic concurrency): the
 *     caller passes the updatedAt it read with get_draft, and the UPDATE is
 *     `WHERE id = … AND user_id = … AND status = 'draft' AND updated_at = …`.
 *     No row back means someone else got there first: the row is read again
 *     only to say which refusal it is ("changed since you read it" or "not a
 *     draft"). Nothing is ever written blind.
 *   - Only the caller's own drafts, as the app's owner RLS allows
 *     (lib/db/drafts.ts runs under the operator's session).
 *   - The columns follow lib/db/drafts.ts saveDraftToDb: name, objective,
 *     ad_account_id, client_id and event_id from the draft's settings, the
 *     whole draft_json, and updated_at (also written to draft_json.updatedAt).
 *     The edit is laid over the stored draft_json (keepUnmigratedFields), so
 *     nothing migrateDraft leaves out is lost by an MCP write.
 *   - Archive changes the status column only, as the library's Archive does
 *     (updateCampaignStatus), so the library's Unarchive restores it as it was.
 *
 * Relative imports only (node:test).
 */
import type { CampaignDraft } from "../../types.ts";
import { ToolInputError, type Db, type ToolContext } from "../tool-types.ts";

export const DRAFT_WRITE_COLUMNS = "id, user_id, name, status, objective, event_id, client_id, ad_account_id, updated_at, draft_json";

export interface DraftRecord {
  id: string;
  user_id: string | null;
  name: string | null;
  status: string | null;
  objective: string | null;
  event_id: string | null;
  client_id: string | null;
  ad_account_id: string | null;
  updated_at: string;
  draft_json: Record<string, unknown> | null;
}

/** What the tools tell Claude, word for word. */
export const DRAFT_REFUSALS = {
  notFound: (id: string) => `No draft with id ${id}.`,
  notDraft: (status: string) =>
    `This draft is ${status}, so it can't be changed from here. Only drafts with status draft can be changed; changes to live campaigns come later.`,
  changed: "This draft changed since you read it. Read it again with get_draft and use its new updatedAt.",
  notYours: "This draft belongs to another account, so it can't be changed from here.",
  badUpdatedAt: "Give updated_at exactly as get_draft returned it (updatedAt).",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertDraftId(id: unknown): string {
  const s = typeof id === "string" ? id.trim() : "";
  if (!UUID.test(s)) throw new ToolInputError("Give a draft id (a UUID) from get_drafts.");
  return s;
}

/**
 * A timestamp as one comparable key, to the microsecond: Postgres keeps
 * microseconds, JavaScript's Date keeps milliseconds, so the fraction is
 * compared as text. Null when it isn't a timestamp.
 */
export function instantKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(value.trim());
  if (!m) return null;
  let zone = m[4] ?? "Z";
  if (/^[+-]\d{2}$/.test(zone)) zone = `${zone}:00`;
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const seconds = Date.parse(`${m[1]}T${m[2]}${zone}`);
  if (Number.isNaN(seconds)) return null;
  return `${seconds / 1000}.${(m[3] ?? "").padEnd(6, "0").slice(0, 6)}`;
}

export function sameInstant(a: unknown, b: unknown): boolean {
  const x = instantKey(a);
  return x !== null && x === instantKey(b);
}

export async function readDraftRow(db: Db, id: string): Promise<DraftRecord | null> {
  const res = await db.from("campaign_drafts").select(DRAFT_WRITE_COLUMNS).eq("id", id).maybeSingle();
  if (res.error) throw new Error(`campaign_drafts read: ${res.error.message}`);
  return (res.data as DraftRecord | null) ?? null;
}

export interface WritableDraft {
  row: DraftRecord;
  /** draft_json through migrateDraft, as the app reads it. */
  draft: CampaignDraft;
}

/** The draft as the app reads it (migrateDraft over a copy of draft_json). */
export function migratedDraft(ctx: ToolContext, row: DraftRecord): CampaignDraft {
  const raw = structuredClone(row.draft_json ?? {}) as Record<string, unknown>;
  return ctx.readers.migrateDraft(raw) as unknown as CampaignDraft;
}

/**
 * Reads the draft a tool will change and refuses, in this order: missing,
 * someone else's, not a draft, changed since the caller read it.
 */
export async function loadWritableDraft(ctx: ToolContext, idArg: unknown, updatedAtArg: unknown): Promise<WritableDraft> {
  const id = assertDraftId(idArg);
  if (instantKey(updatedAtArg) === null) throw new ToolInputError(DRAFT_REFUSALS.badUpdatedAt, { draftId: id, refused: "bad_updated_at" });
  const row = await readDraftRow(ctx.db, id);
  if (!row) throw new ToolInputError(DRAFT_REFUSALS.notFound(id), { draftId: id, refused: "not_found" });
  if (row.user_id !== ctx.userId) throw new ToolInputError(DRAFT_REFUSALS.notYours, { draftId: id, refused: "not_owner" });
  const status = row.status ?? "draft";
  if (status !== "draft") throw new ToolInputError(DRAFT_REFUSALS.notDraft(status), { draftId: id, refused: "not_draft", status });
  if (!sameInstant(row.updated_at, updatedAtArg)) {
    throw new ToolInputError(DRAFT_REFUSALS.changed, { draftId: id, refused: "changed_since_read" });
  }
  return { row, draft: migratedDraft(ctx, row) };
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * The edited draft laid over the stored draft_json, so a field migrateDraft
 * doesn't carry (a creative's metaCreativeId, a newer field it doesn't know
 * yet) is never wiped by an MCP write. The edit wins wherever it says
 * anything, an explicit `undefined` included; arrays match by `id`, and an
 * element the edit left out stays out.
 */
export function keepUnmigratedFields(stored: unknown, edited: unknown): unknown {
  if (Array.isArray(edited)) {
    if (!Array.isArray(stored)) return edited;
    const byId = new Map<string, unknown>();
    for (const x of stored) if (isObj(x) && typeof x.id === "string") byId.set(x.id, x);
    return edited.map((e) => (isObj(e) && typeof e.id === "string" && byId.has(e.id) ? keepUnmigratedFields(byId.get(e.id), e) : e));
  }
  if (isObj(edited)) {
    if (!isObj(stored)) return edited;
    const out: Record<string, unknown> = { ...stored };
    for (const [k, v] of Object.entries(edited)) out[k] = keepUnmigratedFields(stored[k], v);
    return out;
  }
  return edited;
}

/** The saveDraftToDb columns for a draft (empty strings become NULL, as there). */
function columnsOf(draft: CampaignDraft) {
  return {
    name: draft.settings?.campaignName || null,
    objective: draft.settings?.objective || null,
    ad_account_id: draft.settings?.adAccountId || null,
    client_id: draft.settings?.clientId || null,
    event_id: draft.settings?.eventId || null,
  };
}

/** After a guarded write found no row: which refusal it is. */
async function refusalAfterMiss(ctx: ToolContext, id: string): Promise<never> {
  const now = await readDraftRow(ctx.db, id);
  if (!now) throw new ToolInputError(DRAFT_REFUSALS.notFound(id), { draftId: id, refused: "not_found" });
  if (now.user_id !== ctx.userId) throw new ToolInputError(DRAFT_REFUSALS.notYours, { draftId: id, refused: "not_owner" });
  const status = now.status ?? "draft";
  if (status !== "draft") throw new ToolInputError(DRAFT_REFUSALS.notDraft(status), { draftId: id, refused: "not_draft", status });
  throw new ToolInputError(DRAFT_REFUSALS.changed, { draftId: id, refused: "changed_since_read" });
}

/**
 * Saves `next` over the row `loaded` read, only if nothing changed in
 * between. Returns the new updated_at.
 */
export async function saveDraft(ctx: ToolContext, loaded: WritableDraft, next: CampaignDraft): Promise<{ updatedAt: string; draft: CampaignDraft }> {
  const updatedAt = ctx.now.toISOString();
  const draft: CampaignDraft = { ...next, id: loaded.row.id, status: "draft", updatedAt };
  const stored = keepUnmigratedFields(loaded.row.draft_json ?? {}, draft);
  const res = await ctx.db
    .from("campaign_drafts")
    .update({ ...columnsOf(draft), draft_json: stored, updated_at: updatedAt })
    .eq("id", loaded.row.id)
    .eq("user_id", ctx.userId)
    .eq("status", "draft")
    .eq("updated_at", loaded.row.updated_at)
    .select("id, updated_at");
  if (res.error) throw new Error(`campaign_drafts update: ${res.error.message}`);
  const rows = (res.data ?? []) as Array<{ id: string; updated_at: string }>;
  if (rows.length === 0) return refusalAfterMiss(ctx, loaded.row.id);
  return { updatedAt: rows[0]!.updated_at ?? updatedAt, draft };
}

/** Archive: the status column only, as the library's Archive (updateCampaignStatus). The library's Unarchive restores it. */
export async function archiveDraftRow(ctx: ToolContext, loaded: WritableDraft): Promise<{ updatedAt: string }> {
  const updatedAt = ctx.now.toISOString();
  const res = await ctx.db
    .from("campaign_drafts")
    .update({ status: "archived", updated_at: updatedAt })
    .eq("id", loaded.row.id)
    .eq("user_id", ctx.userId)
    .eq("status", "draft")
    .eq("updated_at", loaded.row.updated_at)
    .select("id, updated_at");
  if (res.error) throw new Error(`campaign_drafts archive: ${res.error.message}`);
  const rows = (res.data ?? []) as Array<{ id: string; updated_at: string }>;
  if (rows.length === 0) return refusalAfterMiss(ctx, loaded.row.id);
  return { updatedAt: rows[0]!.updated_at ?? updatedAt };
}

/** A new row for replicate_to_event, as lib/actions/replicate-to-event.ts saves it: status draft, owned by the caller. */
export async function insertDraft(ctx: ToolContext, draft: CampaignDraft): Promise<{ id: string; updatedAt: string }> {
  const updatedAt = draft.updatedAt || ctx.now.toISOString();
  const res = await ctx.db
    .from("campaign_drafts")
    .insert({ id: draft.id, user_id: ctx.userId, status: "draft", ...columnsOf(draft), draft_json: { ...draft, status: "draft", updatedAt }, updated_at: updatedAt })
    .select("id, updated_at");
  if (res.error) throw new Error(`campaign_drafts insert: ${res.error.message}`);
  const row = ((res.data ?? []) as Array<{ id: string; updated_at: string }>)[0];
  return { id: row?.id ?? draft.id, updatedAt: row?.updated_at ?? updatedAt };
}
