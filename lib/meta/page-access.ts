import "server-only";

/**
 * lib/meta/page-access.ts
 *
 * Pre-flight access check for page-engagement custom audiences.
 *
 * Meta builds a multi-page page-engagement audience ATOMICALLY: if the token
 * lacks access to even ONE page in the source set, the ENTIRE
 * POST /customaudiences fails with #200 subcode 1713153 ("permissions") and no
 * audience is created. (Observed 2026-05: the "Innervisions" audience referenced
 * 7 pages — Âme + 6 others — and a single inaccessible page killed the whole
 * create.)
 *
 * A page is treated as accessible when EITHER of these holds:
 *   1. The per-page `tasks` probe (run with the user's OAuth token) returns a
 *      qualifying task — covers pages the user manages directly.
 *   2. The page appears in the client's Business Manager page list (owned_pages
 *      or client_pages) — covers BM-partner-shared pages granted at the
 *      "Ads and Insights" tier (ADVERTISE + ANALYZE), where the personal token's
 *      per-page `tasks` probe comes back EMPTY because the grant is BM-mediated,
 *      not user-direct. This was the Innervisions failure mode in PR #425.
 *
 * The BM page list is injected by the caller (it needs the resolved business id);
 * when unavailable we fall back to the per-page probe alone.
 */

/**
 * Page `tasks` that are sufficient to use a Page as a custom-audience source.
 *
 * Full Meta task enum: ADVERTISE, ANALYZE, CREATE_CONTENT, MANAGE, MESSAGING,
 * MODERATE. We accept everything that implies ad/insight or content access — the
 * "Ads and Insights" partner-share tier grants ADVERTISE + ANALYZE, which is
 * enough to read engagement into a Custom Audience. Only MESSAGING (inbox-only)
 * is excluded, as it grants no ad/insight access.
 */
const SUFFICIENT_PAGE_TASKS = new Set([
  "MANAGE",
  "CREATE_CONTENT",
  "MODERATE",
  "ADVERTISE",
  "ANALYZE",
]);

export interface DroppedPage {
  pageId: string;
  name?: string;
  /** Why the page was excluded — Meta error message or "no admin role". */
  reason: string;
}

export interface PageAccessResult {
  /** Requested pages the token can use, in the caller's original order. */
  accessiblePageIds: string[];
  /** Requested pages excluded because the token can't access them. */
  dropped: DroppedPage[];
  /** Page id → name, for any page we could name (accessible or dropped). */
  names: Record<string, string>;
}

/** Subset of the Page node we read from the probe. */
interface PageProbe {
  id?: string;
  name?: string;
  tasks?: string[];
}

/** Per-page probe — injectable so the partitioning logic is unit-testable. */
export type PageProbeFn = (pageId: string, token: string) => Promise<PageProbe>;

/**
 * Resolver for pages a Business Manager can access — `pageId → name` for both
 * owned and partner-shared pages. Injectable so the partitioning logic stays
 * testable without hitting the Graph API. See {@link businessSharedPages} for
 * the live implementation.
 */
export type BusinessPagesFn = (token: string) => Promise<Map<string, string>>;

export interface ResolvePageAccessOptions {
  /** Per-page tasks probe. Defaults to a live GET /{page_id}?fields=id,name,tasks. */
  probe?: PageProbeFn;
  /**
   * BM-accessible page list (owned + partner-shared). When provided, a requested
   * page present here is accessible EVEN IF its per-page tasks probe is empty —
   * this is what rescues BM-mediated "Ads and Insights" grants whose personal
   * token can't see per-page tasks.
   */
  businessPages?: BusinessPagesFn;
}

// Lazy import of the Graph client: keeps this module free of `@/lib/meta/client`
// (which pulls in the whole Graph layer) at load time, so the partitioning logic
// stays unit-testable with an injected probe under the strip-types test runner.
const defaultProbe: PageProbeFn = async (pageId, token) => {
  const { graphGetWithToken } = await import("@/lib/meta/client");
  return graphGetWithToken<PageProbe>(
    `/${pageId}`,
    { fields: "id,name,tasks" },
    token,
  );
};

/** Row shape from /{business_id}/owned_pages and /{business_id}/client_pages. */
interface BmPageRow {
  id?: string;
  name?: string;
  /** Present on client_pages; we don't gate on it — presence in the edge is the
   *  access signal — but request it so the field is available for diagnostics. */
  access_status?: string;
}

interface BmPagedResponse {
  data?: BmPageRow[];
  paging?: { next?: string; cursors?: { after?: string } };
}

/**
 * Build a {@link BusinessPagesFn} that enumerates every page a Business Manager
 * can access: `owned_pages` (fully owned) PLUS `client_pages` (partner-shared,
 * e.g. the "Ads and Insights" tier). Both edges are paginated.
 *
 * Best-effort: a failing edge contributes nothing rather than throwing, so a
 * partial Graph outage degrades to the per-page tasks probe instead of failing
 * the whole audience create. Lazy-imports the Graph client (see defaultProbe).
 */
export function businessSharedPages(businessId: string): BusinessPagesFn {
  return async (token) => {
    const { graphGetWithToken } = await import("@/lib/meta/client");
    const map = new Map<string, string>();

    async function collect(edge: string, fields: string): Promise<void> {
      let after: string | undefined;
      // Hard page cap (25 × 200 = 5000) guards against a runaway cursor loop.
      for (let i = 0; i < 25; i++) {
        const params: Record<string, string> = { fields, limit: "200" };
        if (after) params.after = after;
        let res: BmPagedResponse;
        try {
          res = await graphGetWithToken<BmPagedResponse>(
            `/${businessId}/${edge}`,
            params,
            token,
          );
        } catch {
          return; // best-effort: stop this edge, keep what we have
        }
        for (const row of res.data ?? []) {
          if (row.id && !map.has(row.id)) map.set(row.id, row.name ?? row.id);
        }
        after = res.paging?.cursors?.after;
        if (!after || !res.paging?.next) break;
      }
    }

    await Promise.all([
      collect("owned_pages", "id,name"),
      collect("client_pages", "id,name,access_status"),
    ]);
    return map;
  };
}

/**
 * Probe each page and partition into accessible vs dropped. A page is accessible
 * when EITHER:
 *   (a) it appears in the BM page list ({@link ResolvePageAccessOptions.businessPages}),
 *       which covers partner-shared "Ads and Insights" grants, OR
 *   (b) its per-page tasks probe holds one of {@link SUFFICIENT_PAGE_TASKS}.
 *
 * (a) is checked first and short-circuits the probe — BM-shared pages return no
 * per-page tasks to a personal token, so probing them is wasted (and errors).
 * Pages matching neither are dropped with a reason. Never throws on a single
 * inaccessible page; the caller decides what to do with an empty result. Probes
 * run concurrently; both output lists preserve the caller's original ordering.
 */
export async function resolvePageAccess(
  pageIds: string[],
  token: string,
  options: ResolvePageAccessOptions = {},
): Promise<PageAccessResult> {
  const probe = options.probe ?? defaultProbe;
  const ordered = [...new Set(pageIds.map((id) => id.trim()).filter(Boolean))];
  const names: Record<string, string> = {};
  const accessible = new Set<string>();
  const dropReason = new Map<string, string>();

  // Pages the Business Manager can reach (owned + partner-shared). Best-effort:
  // if the resolver is absent or fails we degrade to the per-page probe alone.
  let bmPages = new Map<string, string>();
  if (options.businessPages) {
    try {
      bmPages = await options.businessPages(token);
    } catch {
      bmPages = new Map();
    }
  }

  await Promise.all(
    ordered.map(async (pageId) => {
      // (a) BM-mediated access short-circuits the per-page probe.
      if (bmPages.has(pageId)) {
        names[pageId] = bmPages.get(pageId)!;
        accessible.add(pageId);
        return;
      }
      // (b) per-page tasks probe with the user token.
      try {
        const page = await probe(pageId, token);
        if (page.name) names[pageId] = page.name;
        const tasks = Array.isArray(page.tasks) ? page.tasks : [];
        if (tasks.some((task) => SUFFICIENT_PAGE_TASKS.has(task))) {
          accessible.add(pageId);
        } else {
          dropReason.set(
            pageId,
            tasks.length
              ? `token has only [${tasks.join(", ")}] and the page is not in ` +
                  `the client's Business Manager`
              : "token has no role on this page and it is not in the client's " +
                  "Business Manager",
          );
        }
      } catch (err) {
        dropReason.set(pageId, probeErrorMessage(err));
      }
    }),
  );

  return {
    accessiblePageIds: ordered.filter((id) => accessible.has(id)),
    dropped: ordered
      .filter((id) => dropReason.has(id))
      .map((id) => ({ pageId: id, name: names[id], reason: dropReason.get(id)! })),
    names,
  };
}

/** Human-readable "Name (id)" label, falling back to the bare id. */
export function pageLabel(pageId: string, names: Record<string, string>): string {
  const name = names[pageId];
  return name ? `${name} (${pageId})` : pageId;
}

// Duck-typed so a thrown MetaApiError (code/subcode) reads nicely without
// importing the class — see the lazy-import note on defaultProbe above.
function probeErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const e = err as { message?: unknown; code?: unknown; subcode?: unknown };
    const msg = typeof e.message === "string" ? e.message : String(err);
    const code =
      typeof e.code === "number"
        ? ` (code ${e.code}${typeof e.subcode === "number" ? `/${e.subcode}` : ""})`
        : "";
    return `${msg}${code}`;
  }
  return err instanceof Error ? err.message : String(err);
}
