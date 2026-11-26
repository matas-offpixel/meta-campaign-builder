/**
 * lib/mcp/audience-deps.ts
 *
 * The real McpAudienceDeps (M3c) for the route: the only place the
 * connector's audience and artist-access tools reach Meta, and only through
 * the app's own paths. Not imported by tests (they pass spies); the guard
 * test pins what this file imports and its one POST.
 *
 *   - reads: GETs with the operator's token (resolveServerMetaToken, as the
 *     Audience Builder reads), the purchase read's ad-set batch and pixel
 *     stats, CIRQLIN's page links (RT11), the builder's page-access check and
 *     its show-video walk;
 *   - createAudience: the Audience Builder's own create (createAudienceDraft,
 *     then createMetaCustomAudience behind OFFPIXEL_META_AUDIENCE_WRITES_ENABLED,
 *     with its reuse of a rule already on the account and its own
 *     meta_audience_write_idempotency ledger), on the service-role client.
 *     Seed grants are off: the connector never grants itself a Page role;
 *   - the Business Manager reads and requestPage run as Matas's personal
 *     token (resolveUserFacebookToken: user_facebook_tokens, never the env
 *     token). requestPage is lib/meta/page-access-request.ts with its one
 *     POST /{business}/client_pages, ledgered as page_access_request.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAudienceDraft } from "@/lib/db/meta-custom-audiences";
import { createMetaCustomAudience, metaAudienceWritesEnabled } from "@/lib/meta/audience-write";
import { graphGetWithToken, graphPostWithToken } from "@/lib/meta/client";
import { graphMultiGetByIds } from "@/lib/meta/graph-multi-get";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { businessSharedPages, resolvePageAccess } from "@/lib/meta/page-access";
import { paginateAll } from "@/lib/meta/business-manager";
import { writePageAccessRequest } from "@/lib/meta/page-access-request";
import { resolveUserFacebookToken } from "@/lib/bm/user-token";
import { fetchAudienceMultiCampaignVideos } from "@/lib/audiences/sources";
import { fetchAdSetPixels, fetchEventHosts } from "@/lib/onsale-refresh/purchase-read";
import { fetchCirqlinPageLinks } from "@/lib/cirqlin/page-links";
import { groupVideosByPage } from "@/lib/retargeting/audiences";
import { linksFromPages } from "@/lib/retargeting/links";
import type { AccountAudience, McpAudienceDeps, PixelEvents } from "./audiences/types";

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const act = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);

const AUDIENCE_FIELDS = "id,name,subtype,retention_days,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status,rule";

/**
 * GET a paged edge (the `after` cursor), at most `pages` pages. Meta answers
 * "Please reduce the amount of data" (code 1) or an unexpected error (code 2)
 * deep into a big account's audiences (read 26 Nov on NX's account, page 4
 * and 5 of 100): that page is asked again at half the limit, down to 10, then
 * once more; after that the read stops and says it's partial, keeping what
 * it has. A first page that fails is an error.
 */
async function edge(path: string, params: Record<string, string>, token: string, pages = 25): Promise<{ rows: Row[]; gets: number; complete: boolean }> {
  const rows: Row[] = [];
  let after: string | undefined;
  let gets = 0;
  let limit = Number(params.limit ?? "100");
  let retried = false;
  for (let i = 0; i < pages; i++) {
    let res: { data?: Row[]; paging?: { next?: string; cursors?: { after?: string } } };
    try {
      gets += 1;
      res = await graphGetWithToken(path, { ...params, limit: String(limit), ...(after ? { after } : {}) }, token, { maxAttempts: 1 });
    } catch (e) {
      if (limit > 10) {
        limit = Math.max(10, Math.floor(limit / 2));
        i -= 1;
        continue;
      }
      if (!retried) {
        retried = true;
        i -= 1;
        continue;
      }
      if (rows.length === 0) throw e;
      return { rows, gets, complete: false };
    }
    retried = false;
    rows.push(...(res?.data ?? []));
    after = res?.paging?.cursors?.after;
    if (!after || !res?.paging?.next) return { rows, gets, complete: true };
  }
  return { rows, gets, complete: false };
}

const noSeedGrants = async (_db: unknown, sourceIds: string[]) => ({ remediated: [] as string[], skipped: sourceIds.map((sourceId) => ({ sourceId, reason: "seed grants are off for the connector" })) });

export function realAudienceDeps(db: SupabaseClient): McpAudienceDeps {
  const operator = new Map<string, Promise<string>>();
  const opToken = (userId: string) => {
    if (!operator.has(userId)) operator.set(userId, resolveServerMetaToken(db, userId).then((r) => r.token));
    return operator.get(userId)!;
  };
  const personal = (userId: string) => resolveUserFacebookToken(db, userId).then((r) => r.token);

  return {
    audienceWrites: () => metaAudienceWritesEnabled(),
    async listAudiences(userId, adAccountId) {
      const { rows, gets, complete } = await edge(`/${act(adAccountId)}/customaudiences`, { fields: AUDIENCE_FIELDS, limit: "100" }, await opToken(userId), 100);
      const audiences: AccountAudience[] = rows.map((r) => ({
        id: String(r.id),
        name: str(r.name),
        subtype: str(r.subtype),
        retentionDays: num(r.retention_days),
        lower: num(r.approximate_count_lower_bound),
        upper: num(r.approximate_count_upper_bound),
        delivery: str((r.delivery_status as Row | undefined)?.description) ?? (r.delivery_status ? String((r.delivery_status as Row).code ?? "") || null : null),
        operation: str((r.operation_status as Row | undefined)?.description) ?? (r.operation_status ? String((r.operation_status as Row).code ?? "") || null : null),
        rule: typeof r.rule === "string" ? r.rule : r.rule ? JSON.stringify(r.rule) : null,
      }));
      return { audiences, metaGets: gets, complete };
    },
    async promotePages(userId, adAccountId) {
      const { rows, gets } = await edge(`/${act(adAccountId)}/promote_pages`, { fields: "id,name,instagram_business_account{id,username}", limit: "100" }, await opToken(userId), 10);
      return {
        pages: rows.map((r) => ({ id: String(r.id), name: str(r.name), igId: str((r.instagram_business_account as Row | undefined)?.id), igUsername: str((r.instagram_business_account as Row | undefined)?.username) })),
        metaGets: gets,
      };
    },
    async pageAccess(userId, pageIds, businessId) {
      const res = await resolvePageAccess([...pageIds], await opToken(userId), businessId ? { businessPages: businessSharedPages(businessId) } : {});
      return { accessible: res.accessiblePageIds, names: res.names, metaGets: pageIds.length + (businessId ? 2 : 0) };
    },
    async adSetPixels(userId, adsetIds) {
      const token = await opToken(userId);
      const res = await fetchAdSetPixels((path, params) => graphMultiGetByIds(path, params, token), adsetIds);
      if (res.error) throw new Error("ad set pixels unread");
      return { pixels: res.pixels, metaGets: res.calls };
    },
    async pixelEvents(userId, pixelId) {
      const token = await opToken(userId);
      const get = (path: string, params: Record<string, string>) => graphGetWithToken<unknown>(path, params, token, { maxAttempts: 1 });
      let gets = 1;
      const name = await graphGetWithToken<{ name?: string }>(`/${pixelId}`, { fields: "name" }, token, { maxAttempts: 1 })
        .then((r) => r?.name?.trim() || null)
        .catch(() => null);
      const events: PixelEvents = { Purchase: null, InitiateCheckout: null, CompleteRegistration: null };
      for (const ev of ["Purchase", "InitiateCheckout", "CompleteRegistration"] as const) {
        const read = await fetchEventHosts(get, pixelId, new Date(), 28, ev);
        gets += read.calls;
        events[ev] = read.error ? null : read.rows.reduce((s, r) => s + r.count, 0);
      }
      return { name, events, metaGets: gets };
    },
    async pageLinks(tag) {
      const res = await fetchCirqlinPageLinks(tag);
      if (!res.ok) return null;
      return linksFromPages(res.pages).map((l) => ({ kind: l.kind, name: l.name, url: `https://${l.rule}`, rule: l.rule }));
    },
    async showVideos(userId, adAccountId, campaignIds) {
      const res = await fetchAudienceMultiCampaignVideos(act(adAccountId), [...campaignIds], await opToken(userId));
      return groupVideosByPage(res.videos as { id: string; pageId?: string | null }[]);
    },
    async createAudience({ userId, insert }) {
      const draft = await createAudienceDraft(insert, db);
      const made = await createMetaCustomAudience(draft.id, { userId, supabase: db as never, rows: db, remediateSeeds: noSeedGrants });
      return { rowId: made.id, metaAudienceId: made.metaAudienceId, reused: made.reused === true, failed: made.status === "failed" };
    },
    async accountBusiness(userId, adAccountId) {
      const r = await graphGetWithToken<{ business?: { id?: string; name?: string } }>(`/${act(adAccountId)}`, { fields: "business{id,name}" }, await opToken(userId), { maxAttempts: 1 });
      return r?.business?.id ? { id: String(r.business.id), name: r.business.name ?? null } : null;
    },
    async tokenPermissions(userId) {
      let token: string;
      try {
        token = await personal(userId);
      } catch {
        return null;
      }
      const res = await graphGetWithToken<{ data?: { permission?: string; status?: string }[] }>("/me/permissions", {}, token, { maxAttempts: 1 });
      return new Set((res?.data ?? []).filter((p) => p.status === "granted" && p.permission).map((p) => String(p.permission)));
    },
    async businessRole(userId, businessId) {
      // His business-scoped users, each with its role (GET /me/business_users, paged).
      const users = await paginateAll<{ role?: string; business?: { id?: string } }>("/me/business_users", { fields: "role,business{id}", limit: "100" }, await personal(userId));
      return users.find((u) => String(u.business?.id ?? "") === businessId)?.role ?? null;
    },
    async businessPages(userId, businessId) {
      const map = await businessSharedPages(businessId)(await personal(userId));
      return new Set(map.keys());
    },
    async pendingPages(userId, businessId) {
      // Meta answers ids only on this edge (read 26 Nov: name isn't returned even when asked): each id is the Page asked for.
      const rows = await paginateAll<Row>(`/${businessId}/pending_client_pages`, { limit: "100" }, await personal(userId));
      return rows.map((r) => ({ id: String(r.id), pageId: str(r.id), pageName: str(r.name) }));
    },
    async requestPage({ userId, businessId, pageId, tasks, ledger, key }) {
      const token = await personal(userId);
      await writePageAccessRequest({
        ledger: { supabase: db, userId, draftId: ledger.draftId, eventId: ledger.eventId },
        graph: { postClientPage: (b, body) => graphPostWithToken(`/${b}/client_pages`, body, token).then(() => undefined) },
        businessId,
        pageId,
        tasks,
        key,
      });
    },
  };
}
