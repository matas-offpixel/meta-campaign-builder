import "server-only";

/**
 * lib/meta/page-access.ts
 *
 * Pre-flight access check for page-engagement custom audiences.
 *
 * Meta builds a multi-page page-engagement audience ATOMICALLY: if the token
 * lacks admin access to even ONE page in the source set, the ENTIRE
 * POST /customaudiences fails with #200 subcode 1713153 ("permissions") and no
 * audience is created. (Observed 2026-05: the "Innervisions" audience referenced
 * 7 pages — Âme + 6 others — and a single inaccessible page killed the whole
 * create.)
 *
 * To avoid that, we probe each requested page with the SAME token used for the
 * write (the user's OAuth token via resolveServerMetaToken) and let the caller
 * build the rule only from pages the token can actually access.
 */

/**
 * Page `tasks` that are sufficient to use a Page as a custom-audience source.
 * MANAGE / CREATE_CONTENT are admin-level; ADVERTISE is the ad-operations role —
 * any one means Meta will accept the page in the audience rule.
 *
 * Full Meta task enum: ADVERTISE, ANALYZE, CREATE_CONTENT, MANAGE, MESSAGING,
 * MODERATE. We deliberately do NOT count ANALYZE / MESSAGING / MODERATE — those
 * don't grant the access Meta requires to read engagement into an audience.
 */
const SUFFICIENT_PAGE_TASKS = new Set(["MANAGE", "CREATE_CONTENT", "ADVERTISE"]);

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

/**
 * Probe each page with `token` and partition into accessible vs dropped.
 *
 * A page is accessible when the probe succeeds AND the token holds at least one
 * of {@link SUFFICIENT_PAGE_TASKS} on it. Pages that error (typically #200 /
 * #190) or expose no qualifying task are dropped with a reason.
 *
 * Never throws on a single inaccessible page — partitioning is the whole point.
 * The caller decides what to do with an empty `accessiblePageIds`. Probes run
 * concurrently; both output lists preserve the caller's original ordering.
 */
export async function resolvePageAccess(
  pageIds: string[],
  token: string,
  probe: PageProbeFn = defaultProbe,
): Promise<PageAccessResult> {
  const ordered = [...new Set(pageIds.map((id) => id.trim()).filter(Boolean))];
  const names: Record<string, string> = {};
  const accessible = new Set<string>();
  const dropReason = new Map<string, string>();

  await Promise.all(
    ordered.map(async (pageId) => {
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
              ? `token has only [${tasks.join(", ")}] on this page ` +
                  `(needs MANAGE, CREATE_CONTENT, or ADVERTISE)`
              : "token has no admin role on this page",
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
