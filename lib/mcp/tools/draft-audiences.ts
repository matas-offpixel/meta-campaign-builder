/**
 * lib/mcp/tools/draft-audiences.ts — set_draft_audiences (M2b).
 *
 * The Audiences step's group edits, through its own rules, saved with the
 * guarded write (lib/mcp/drafts/write.ts):
 *
 *   - remove: the panels' removeGroup (a page, custom or interest group);
 *   - rename: the group's name (nameSource "operator" for interest groups);
 *   - merge: interest groups (or custom groups) into one, named; the first
 *     group keeps its id and takes the others' interests (or audience ids),
 *     deduped, in order;
 *   - add_interests: the interest picker's search (Meta's interest search, a
 *     GET through ctx.draft.interestSearch) and its addInterest (deduped,
 *     enrichWithTargetability), into a group or a new one;
 *   - add_custom: existing custom audiences in the draft's ad account, by
 *     Meta id, as a new custom group. "Existing" is what the app recorded in
 *     that account (meta_custom_audiences, ready): no Meta read.
 *
 * Ad sets follow their groups (lib/wizard/follow-audience-groups.ts): a
 * removed or merged-away group's ad sets go, a new or changed group gets
 * Generate's ad sets if it has none, and every other row is kept as it is.
 */
import { z } from "zod";
import { enrichWithTargetability } from "../../interest-targetability.ts";
import { normalizeAccount } from "../../audience-templates/resolve.ts";
import type { AudienceSettings, CampaignDraft, CustomAudienceGroup, InterestGroup, InterestSuggestion } from "../../types.ts";
import { followAudienceGroups, groupKey, type AudienceGroupKind } from "../../wizard/follow-audience-groups.ts";
import { forAdSets } from "../../wizard/assignments.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { requireDraftScope } from "../drafts/common.ts";
import { loadWritableDraft } from "../drafts/write.ts";
import { draftArgs, finish } from "./draft-edit.ts";

const interestPick = z.object({
  search: z.string().min(2).max(120).describe('What to search Meta\'s interests for, e.g. "Tech house".'),
  interest_id: z.string().regex(/^\d{5,25}$/).optional().describe("The hit you mean, from an earlier answer's choices."),
});

const change = z
  .object({
    remove: z.string().min(1).max(160).optional().describe("A group id (get_draft audiences.groups) to remove."),
    rename: z.object({ group_id: z.string().min(1).max(160), name: z.string().min(1).max(80) }).optional(),
    merge: z.object({ group_ids: z.array(z.string().min(1).max(160)).min(2).max(20), name: z.string().min(1).max(80) }).optional().describe("Groups of one kind (interest, or custom) into one, named; the first keeps its id."),
    add_interests: z
      .object({
        group_id: z.string().min(1).max(160).optional().describe("The interest group to add to."),
        new_group_name: z.string().min(1).max(80).optional().describe("Or a new interest group with this name."),
        interests: z.array(interestPick).min(1).max(30),
      })
      .optional(),
    add_custom: z
      .object({
        audience_ids: z.array(z.string().regex(/^\d{5,25}$/)).min(1).max(50).describe("Meta custom audience ids in the draft's ad account."),
        name: z.string().min(1).max(80),
      })
      .optional(),
  })
  .describe("One of: remove, rename, merge, add_interests, add_custom.");

type Change = z.infer<typeof change>;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function kindOf(a: AudienceSettings, id: string): AudienceGroupKind | null {
  if (a.pageGroups.some((g) => g.id === id)) return "page";
  if (a.customAudienceGroups.some((g) => g.id === id)) return "custom";
  if (a.interestGroups.some((g) => g.id === id)) return "interest";
  return null;
}

function nameOf(a: AudienceSettings, id: string): string {
  return a.pageGroups.find((g) => g.id === id)?.name ?? a.customAudienceGroups.find((g) => g.id === id)?.name ?? a.interestGroups.find((g) => g.id === id)?.name ?? id;
}

/** Ready custom audiences the app recorded in this account (meta_custom_audiences). */
async function recordedAudiences(ctx: ToolContext, account: string, ids: string[]): Promise<Map<string, string | null>> {
  const acct = normalizeAccount(account);
  if (!acct) return new Map();
  const res = await ctx.db.from("meta_custom_audiences").select("meta_audience_id, meta_ad_account_id, name, status").in("meta_audience_id", ids);
  if (res.error) throw new ToolInputError("The app's audience records couldn't be read. Nothing was saved.", { refused: "audiences_unreadable" });
  const out = new Map<string, string | null>();
  for (const r of (res.data ?? []) as Array<{ meta_audience_id: string; meta_ad_account_id: string | null; name: string | null; status: string | null }>) {
    if (r.status === "ready" && normalizeAccount(r.meta_ad_account_id) === acct) out.set(r.meta_audience_id, r.name ?? null);
  }
  return out;
}

export const setDraftAudiencesTool: McpTool = {
  name: "set_draft_audiences",
  title: "Edit a draft's audiences",
  kind: "draft",
  readOnly: false,
  idempotent: false,
  description: [
    "Edits a draft's audience groups as the Audiences step does, in order, saved together: remove a page, custom or interest group; rename one; merge interest groups, or custom groups, into one named group (deduped; the first group's ad sets stay, the others' go); add interests to a group or a new one (Meta's interest search, a read); add custom audiences that already exist in the draft's ad account (by Meta id, as the app recorded them) as a new group.",
    "An interest search with no exact single match saves nothing and lists the hits with interest_id: call again with the one you mean.",
    "Ad sets follow: a removed or merged-away group's ad sets go; a new group gets its ad sets at the + Blank ad set budget (set them with set_draft_ad_sets); other ad sets keep their budgets and names. Group ids are in get_draft's audiences.groups.",
    'Example: set_draft_audiences({ draft_id: "3f2c…-uuid", updated_at: "2026-11-24T10:00:00.123+00:00", changes: [{ remove: "pg_old" }, { merge: { group_ids: ["ig_a", "ig_b"], name: "House & tech house" } }, { add_interests: { group_id: "ig_a", interests: [{ search: "Defected Records" }] } }] }).',
  ].join(" "),
  inputSchema: {
    ...draftArgs,
    changes: z.array(change).min(1).max(30),
  },
  async run(ctx, args) {
    const deps = requireDraftScope(ctx);
    const list = (Array.isArray(args.changes) ? args.changes : []) as Change[];
    if (list.length === 0) throw new ToolInputError("Give changes.", { refused: "nothing_to_do" });
    for (const c of list) {
      const n = [c.remove, c.rename, c.merge, c.add_interests, c.add_custom].filter((x) => x != null).length;
      if (n !== 1) throw new ToolInputError("Each change is one of: remove, rename, merge, add_interests, add_custom.", { refused: "bad_change" });
      if (c.add_interests && Boolean(c.add_interests.group_id) === Boolean(c.add_interests.new_group_name)) {
        throw new ToolInputError("add_interests takes group_id or new_group_name, one of them.", { refused: "bad_change" });
      }
    }
    const loaded = await loadWritableDraft(ctx, args.draft_id, args.updated_at);
    const { draft } = loaded;
    const refuse = (msg: string, refused: string, data: Record<string, unknown> | null = null, extra: Record<string, unknown> = {}) =>
      new ToolInputError(`${msg} Nothing was saved.`, { draftId: loaded.row.id, refused, ...extra }, data);

    let a: AudienceSettings = structuredClone(draft.audiences);
    const touched = new Set<string>();
    const log: string[] = [];
    let metaGets = 0;
    const choices: Array<{ search: string; hits: Array<{ interest_id: string; name: string; audienceSize: number | null; path: string | null }> }> = [];

    for (const c of list) {
      if (c.remove) {
        const kind = kindOf(a, c.remove);
        if (!kind) throw refuse(`There's no audience group ${c.remove} on this draft.`, "unknown_group");
        log.push(`removed ${kind} group ${nameOf(a, c.remove)}`);
        if (kind === "page") a = { ...a, pageGroups: a.pageGroups.filter((g) => g.id !== c.remove) };
        if (kind === "custom") a = { ...a, customAudienceGroups: a.customAudienceGroups.filter((g) => g.id !== c.remove) };
        if (kind === "interest") a = { ...a, interestGroups: a.interestGroups.filter((g) => g.id !== c.remove) };
        continue;
      }
      if (c.rename) {
        const { group_id: id, name } = c.rename;
        const kind = kindOf(a, id);
        if (!kind) throw refuse(`There's no audience group ${id} on this draft.`, "unknown_group");
        log.push(`renamed ${nameOf(a, id)} to ${name.trim()}`);
        if (kind === "page") a = { ...a, pageGroups: a.pageGroups.map((g) => (g.id === id ? { ...g, name: name.trim() } : g)) };
        if (kind === "custom") a = { ...a, customAudienceGroups: a.customAudienceGroups.map((g) => (g.id === id ? { ...g, name: name.trim() } : g)) };
        if (kind === "interest") a = { ...a, interestGroups: a.interestGroups.map((g) => (g.id === id ? { ...g, name: name.trim(), nameSource: "operator" as const } : g)) };
        touched.add(groupKey(kind, id));
        continue;
      }
      if (c.merge) {
        const ids = [...new Set(c.merge.group_ids)];
        const kinds = ids.map((id) => kindOf(a, id));
        const missing = ids.filter((_, i) => !kinds[i]);
        if (missing.length) throw refuse(`There's no audience group ${missing.join(", ")} on this draft.`, "unknown_group");
        const kind = kinds[0]!;
        if (kind === "page" || kinds.some((k) => k !== kind)) throw refuse("Only groups of one kind merge: interest groups with interest groups, custom groups with custom groups.", "mixed_merge");
        const name = c.merge.name.trim();
        if (kind === "interest") {
          const groups = ids.map((id) => a.interestGroups.find((g) => g.id === id)!) as InterestGroup[];
          const seen = new Set<string>();
          const interests: InterestSuggestion[] = [];
          for (const g of groups) {
            for (const i of g.interests) {
              if (seen.has(i.id)) continue;
              seen.add(i.id);
              interests.push(i);
            }
          }
          const keep = groups[0]!;
          const total = groups.reduce((s, g) => s + g.interests.length, 0);
          log.push(`merged ${ids.length} interest groups into ${name}: ${interests.length} interests (${total - interests.length} duplicates dropped)`);
          const merged: InterestGroup = { ...keep, name, nameSource: "operator", interests };
          a = { ...a, interestGroups: a.interestGroups.filter((g) => !ids.slice(1).includes(g.id)).map((g) => (g.id === keep.id ? merged : g)) };
          touched.add(groupKey("interest", keep.id));
        } else {
          const groups = ids.map((id) => a.customAudienceGroups.find((g) => g.id === id)!) as CustomAudienceGroup[];
          const keep = groups[0]!;
          const audienceIds = [...new Set(groups.flatMap((g) => g.audienceIds))];
          const total = groups.reduce((s, g) => s + g.audienceIds.length, 0);
          const merged: CustomAudienceGroup = {
            ...keep,
            name,
            audienceIds,
            audienceNames: Object.assign({}, ...groups.map((g) => g.audienceNames ?? {})),
            foreignAccountById: Object.assign({}, ...groups.map((g) => g.foreignAccountById ?? {})),
            populatingAudienceIds: [...new Set(groups.flatMap((g) => g.populatingAudienceIds ?? []))],
          };
          log.push(`merged ${ids.length} custom groups into ${name}: ${audienceIds.length} audiences (${total - audienceIds.length} duplicates dropped)`);
          a = { ...a, customAudienceGroups: a.customAudienceGroups.filter((g) => !ids.slice(1).includes(g.id)).map((g) => (g.id === keep.id ? merged : g)) };
          touched.add(groupKey("custom", keep.id));
        }
        continue;
      }
      if (c.add_interests) {
        const picked: InterestSuggestion[] = [];
        for (const p of c.add_interests.interests) {
          let found: Awaited<ReturnType<typeof deps.interestSearch>>;
          try {
            found = await deps.interestSearch({ userId: ctx.userId, query: p.search });
          } catch {
            throw refuse("Meta's interest search didn't answer. Try again.", "search_failed", null, { metaGets });
          }
          metaGets += found.metaGets;
          const exact = found.hits.filter((h) => norm(h.name) === norm(p.search));
          const hit = p.interest_id ? found.hits.find((h) => h.id === p.interest_id) : exact.length === 1 ? exact[0] : found.hits.length === 1 ? found.hits[0] : undefined;
          if (!hit) {
            choices.push({
              search: p.search,
              hits: found.hits.slice(0, 10).map((h) => ({ interest_id: h.id, name: h.name, audienceSize: h.audienceSize ?? null, path: h.path?.join(" > ") ?? null })),
            });
            continue;
          }
          picked.push(enrichWithTargetability({ id: hit.id, name: hit.name, audienceSize: hit.audienceSize, path: hit.path, source: "search" }));
        }
        if (choices.length) continue;
        let gid = c.add_interests.group_id;
        if (gid) {
          if (!a.interestGroups.some((g) => g.id === gid)) throw refuse(`There's no interest group ${gid} on this draft.`, "unknown_group");
        } else {
          gid = deps.newId();
          a = { ...a, interestGroups: [...a.interestGroups, { id: gid, name: c.add_interests.new_group_name!.trim(), nameSource: "operator", interests: [] }] };
        }
        const group = a.interestGroups.find((g) => g.id === gid)!;
        const have = new Set(group.interests.map((i) => i.id));
        const fresh: InterestSuggestion[] = [];
        for (const i of picked) {
          if (have.has(i.id)) continue;
          have.add(i.id);
          fresh.push(i);
        }
        log.push(`added ${fresh.length} interests to ${group.name}${picked.length > fresh.length ? ` (${picked.length - fresh.length} already there)` : ""}`);
        a = { ...a, interestGroups: a.interestGroups.map((g) => (g.id === gid ? { ...g, interests: [...g.interests, ...fresh] } : g)) };
        touched.add(groupKey("interest", gid));
        continue;
      }
      if (c.add_custom) {
        const account = draft.settings.metaAdAccountId || draft.settings.adAccountId || loaded.row.ad_account_id || "";
        const ids = [...new Set(c.add_custom.audience_ids)];
        const known = await recordedAudiences(ctx, account, ids);
        const unknown = ids.filter((id) => !known.has(id));
        if (unknown.length) {
          throw refuse(`These audiences aren't recorded as ready in ${account || "this draft's ad account"}: ${unknown.join(", ")}. Only audiences the app knows in this account can be added from here.`, "unknown_audiences", null, { unknown: unknown.length });
        }
        const names: Record<string, string> = {};
        for (const [id, n] of known) if (n) names[id] = n;
        const g: CustomAudienceGroup = { id: deps.newId(), name: c.add_custom.name.trim(), audienceIds: ids, audienceNames: names };
        a = { ...a, customAudienceGroups: [...a.customAudienceGroups, g] };
        log.push(`added custom group ${g.name}: ${ids.length} audiences`);
        touched.add(groupKey("custom", g.id));
      }
    }
    if (choices.length) {
      throw refuse(`${choices.map((c) => `"${c.search}"`).join(", ")} didn't give one clear interest. Call again with the interest_id you mean.`, "choose_hit", { choices, metaGets }, { metaGets, choices: choices.length });
    }

    const bs = draft.budgetSchedule;
    const follow = followAudienceGroups(draft.adSetSuggestions, a, bs.locationGroups ?? [], bs, touched);
    const next: CampaignDraft = { ...draft, audiences: a, adSetSuggestions: follow.adSets, creativeAssignments: forAdSets(draft.creativeAssignments, follow.adSets) };
    const groupsOut = [
      ...a.pageGroups.map((g) => ({ kind: "page", id: g.id, name: g.name, size: g.pageIds.length })),
      ...a.customAudienceGroups.map((g) => ({ kind: "custom", id: g.id, name: g.name, size: g.audienceIds.length })),
      ...a.interestGroups.map((g) => ({ kind: "interest", id: g.id, name: g.name, size: g.interests.length })),
    ];
    const count = (x: AudienceSettings) => ({ page: x.pageGroups.length, custom: x.customAudienceGroups.length, interest: x.interestGroups.length });
    return finish(ctx, loaded, next, () => ({
      data: {
        done: log,
        groups: groupsOut,
        adSetsRemoved: follow.removed.map((r) => r.name),
        adSetsAdded: follow.added.map((r) => ({ id: r.id, name: r.name, perDayGbp: r.budgetPerDay, lifetimeGbp: r.budgetLifetime ?? null })),
        adSets: follow.adSets.length,
        metaGets,
      },
      summary: {
        fieldsChanged: ["audiences", ...(follow.added.length || follow.removed.length ? ["adSetSuggestions"] : [])],
        before: { groups: count(draft.audiences), adSets: draft.adSetSuggestions.length },
        after: { groups: count(a), adSets: follow.adSets.length },
        adSetsRemovedIds: follow.removed.map((r) => r.id),
        adSetsAddedIds: follow.added.map((r) => r.id),
        metaGets,
      },
    }));
  },
};
