/**
 * lib/mcp/drafts/templates.ts — apply_audience_template's reads and change.
 *
 * The Audience templates tab's "Add to this draft" (words-rc rows
 * templates.apply.*), on what #1363 put on main:
 *
 *   - the client's templates (by its business manager, or the client) and
 *     their items, resolved in the draft's ad account by resolveTemplate
 *     from what the app stored (meta_custom_audiences rows, and the
 *     engagement audiences launches recorded on the client's drafts), the
 *     same reads as lib/actions/audience-templates.ts loadAudienceTemplates;
 *   - only Reused audiences go in, by their Meta ids: lists, pools and page
 *     audiences into one custom group named after the template, interests
 *     into one interest group of the same name; adding twice changes nothing;
 *   - the rest are left out and counted, in Meta audiences: held in another
 *     account (templates.apply.held), video viewers that need the show's
 *     videos (templates.apply.videos), and the others not made yet
 *     (templates.apply.left_out).
 *
 * No Meta call: nothing is created. An unconfirmed template is refused, as
 * the tab's button is off until Matas confirms it.
 *
 * Relative imports only (node:test).
 */
import { loadAllPaged } from "../../db/paged-read.ts";
import { dedupeKnown, knownFromDraftAudiences, knownFromRows, normalizeAccount, resolveTemplate, type CustomAudienceRow, type ResolvedItem, type ResolvedTemplate } from "../../audience-templates/resolve.ts";
import { templateFromRows, type ItemRowIn, type TemplateRowIn } from "../../audience-templates/store.ts";
import type { AudienceSettings, CustomAudienceGroup, InterestGroup } from "../../types.ts";
import { ToolInputError, type Db } from "../tool-types.ts";

/** words-rc-2026-11-24.tsv (258 rows, sha256 f2100dd0…e6ce), word for word. The test checks each against the file. */
export const APPLY_WORDS = {
  "templates.apply": "Add to this draft",
  "templates.apply.done": "Added {template} to {draft}: {n} audiences.",
  "templates.apply.done.one": "Added {template} to {draft}: 1 audience.",
  "templates.apply.left_out": "{m} aren’t made yet, so they’re left out.",
  "templates.apply.left_out.one": "1 isn’t made yet, so it’s left out.",
  "templates.apply.held": "{h} are held in {Meta account name}, so they’re left out.",
  "templates.apply.held.one": "1 is held in {Meta account name}, so it’s left out.",
  "templates.apply.videos": "{k} need this show’s videos picked, so they’re left out.",
  "templates.apply.videos.one": "1 needs this show’s videos picked, so it’s left out.",
  "templates.unconfirmed": "Not confirmed yet",
  "templates.unconfirmed.line": "Matas confirms a template before it’s used.",
} as const;

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{([^{}]+)\}/g, (w, k: string) => (k in v ? String(v[k]) : w));

export interface LoadedTemplates {
  accountId: string;
  templates: ReturnType<typeof templateFromRows>[];
  resolve(name: string): ResolvedTemplate | null;
  accountName(id: string): string;
}

/** The client's templates, resolved in `adAccount`. Database reads only. */
export async function loadTemplatesFor(db: Db, input: { clientId: string; adAccount: string; pixelId: string | null }): Promise<LoadedTemplates> {
  const accountId = normalizeAccount(input.adAccount);
  if (!accountId) throw new ToolInputError("This draft has no ad account, so templates can't be matched to it. Set the ad account first.", { refused: "no_account" });
  const client = await db.from("clients").select("id, meta_business_id").eq("id", input.clientId).maybeSingle();
  if (client.error || !client.data) throw new ToolInputError("Can't find this draft's client.", { refused: "no_client" });
  const businessId = (client.data as { meta_business_id?: string | null }).meta_business_id || null;
  const filter = businessId ? `business_id.eq.${businessId},client_id.eq.${input.clientId}` : `client_id.eq.${input.clientId}`;
  const rows = await loadAllPaged<TemplateRowIn>(db, "audience_templates", "id, name, business_id, client_id, genre_families, notes, confirmed_by, confirmed_at", ["id"], (q) => q.or(filter));
  const items = rows.length
    ? await loadAllPaged<ItemRowIn>(db, "audience_template_items", "id, template_id, kind, list_role, family_key, page_id, retention_days, interest_id, interest_name, meta_audience_id, detail", ["id"], (q) => q.in("template_id", rows.map((r) => r.id)))
    : [];
  const templates = rows.map((t) => templateFromRows(t, items));
  const audienceRows = await loadAllPaged<CustomAudienceRow>(db, "meta_custom_audiences", "id, meta_audience_id, meta_ad_account_id, audience_subtype, list_role, retention_days, source_id, source_meta, event_id, status", ["id"], (q) =>
    q.in("meta_ad_account_id", [accountId, accountId.slice(4)]),
  );
  const draftRows = await loadAllPaged<{ id: string; audiences?: unknown; draft_json?: { audiences?: unknown } | null }>(db, "campaign_drafts", "id, audiences:draft_json->audiences", ["id"], (q) =>
    q.eq("client_id", input.clientId),
  );
  const known = dedupeKnown([...knownFromRows(audienceRows), ...draftRows.flatMap((d) => knownFromDraftAudiences(d.audiences ?? d.draft_json?.audiences))]);
  const names: Record<string, string> = {};
  if (businessId) {
    const accts = await loadAllPaged<{ ad_account_id: string | null; name: string | null }>(db, "bm_ad_accounts", "ad_account_id, name", ["ad_account_id"], (q) => q.eq("business_id", businessId));
    for (const a of accts) {
      const id = normalizeAccount(a.ad_account_id);
      if (id && a.name?.trim()) names[id] = a.name.trim();
    }
  }
  return {
    accountId,
    templates,
    resolve(name) {
      const t = templates.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
      return t ? resolveTemplate(t.items, accountId, known, input.pixelId) : null;
    },
    accountName: (id) => names[normalizeAccount(id) ?? id] ?? id,
  };
}

/** One template's id in the draft: a second Add lands in the same groups. */
export const templateGroupId = (name: string) => `template:${name}`;

export interface AddOutcome {
  audiences: AudienceSettings;
  /** Meta audiences (and the interests, as one) now in the draft from this template. */
  added: number;
  /** Ids newly added by this call. */
  newIds: string[];
  newInterests: number;
  leftOut: { notMade: number; held: Array<{ account: string; n: number }>; needVideos: number };
}

const isVideoViewers = (r: ResolvedItem) => r.item.kind === "retargeting_pool" && r.item.listRole === "video_viewers";

/** Reused audiences into the draft; the rest counted. Pure. */
export function addReusedToDraft(audiences: AudienceSettings, templateName: string, resolved: ResolvedTemplate): AddOutcome {
  const gid = templateGroupId(templateName);
  const ids: string[] = [];
  const names: Record<string, string> = {};
  const interests: Array<{ id: string; name: string }> = [];
  let notMade = 0;
  let needVideos = 0;
  const held = new Map<string, number>();
  for (const r of resolved.items) {
    if (r.item.kind === "interest") {
      if (r.item.interestId) interests.push({ id: r.item.interestId, name: r.item.interestName ?? r.item.interestId });
      continue;
    }
    for (const id of r.reusedIds) {
      if (!ids.includes(id)) ids.push(id);
      if (typeof r.item.detail.name === "string") names[id] = r.item.detail.name;
    }
    if (r.status === "reused") continue;
    const holder = r.heldIn ? normalizeAccount(r.heldIn) : null;
    if (holder && holder !== resolved.accountId) held.set(holder, (held.get(holder) ?? 0) + 1);
    else if (isVideoViewers(r)) needVideos += 1;
    else notMade += r.item.kind === "page_engagers" ? Math.max(1, r.metaCreates) : 1;
  }

  const custom: CustomAudienceGroup[] = [...audiences.customAudienceGroups];
  const at = custom.findIndex((g) => g.id === gid);
  const had = at >= 0 ? custom[at]!.audienceIds : [];
  const newIds = ids.filter((id) => !had.includes(id));
  if (ids.length) {
    if (at >= 0) custom[at] = { ...custom[at]!, audienceIds: [...had, ...newIds], audienceNames: { ...(custom[at]!.audienceNames ?? {}), ...names } };
    else custom.push({ id: gid, name: templateName, audienceIds: ids, audienceNames: names });
  }
  const groups: InterestGroup[] = [...audiences.interestGroups];
  const ai = groups.findIndex((g) => g.id === gid);
  const haveInterests = new Set(ai >= 0 ? groups[ai]!.interests.map((i) => i.id) : []);
  const fresh = interests.filter((i) => !haveInterests.has(i.id));
  if (interests.length) {
    if (ai >= 0) groups[ai] = { ...groups[ai]!, interests: [...groups[ai]!.interests, ...fresh] };
    else groups.push({ id: gid, name: templateName, interests });
  }
  return {
    audiences: { ...audiences, customAudienceGroups: custom, interestGroups: groups },
    added: ids.length + (interests.length ? 1 : 0),
    newIds,
    newInterests: fresh.length,
    leftOut: { notMade, held: [...held.entries()].map(([account, n]) => ({ account, n })), needVideos },
  };
}

/** The sentences the tab shows after Add, in its order. */
export function applySentences(out: AddOutcome, template: string, draft: string, accountName: (id: string) => string): string[] {
  const lines = [out.added === 1 ? fill(APPLY_WORDS["templates.apply.done.one"], { template, draft }) : fill(APPLY_WORDS["templates.apply.done"], { template, draft, n: out.added })];
  const m = out.leftOut.notMade;
  if (m > 0) lines.push(m === 1 ? APPLY_WORDS["templates.apply.left_out.one"] : fill(APPLY_WORDS["templates.apply.left_out"], { m }));
  for (const h of out.leftOut.held) {
    const name = accountName(h.account);
    lines.push(h.n === 1 ? fill(APPLY_WORDS["templates.apply.held.one"], { "Meta account name": name }) : fill(APPLY_WORDS["templates.apply.held"], { h: h.n, "Meta account name": name }));
  }
  const k = out.leftOut.needVideos;
  if (k > 0) lines.push(k === 1 ? APPLY_WORDS["templates.apply.videos.one"] : fill(APPLY_WORDS["templates.apply.videos"], { k }));
  return lines;
}
