/**
 * CIRQLIN's consented signups for one page, as hashes only (SU3).
 *
 * GET {CIRQLIN_API_BASE}/api/partner/signups/hashed
 *       ?crm_base_tag={tag}&scope=show|promoter&since={cursor}
 *   Authorization: Bearer {CIRQLIN_PARTNER_READ_SECRET}
 *
 * The shape is the spec's (scratch/campaign-replicate/signups-to-meta.md,
 * "To the CIRQLIN thread"):
 *
 *   { cursor, added: [{ em?, ph? }], removed: [{ em?, ph? }],
 *     counts: { consented_show, consented_promoter, not_consented },
 *     has_more? }
 *
 * `em` is sha256(lower(trim(email))) and `ph` sha256(E.164 digits, no plus),
 * both 64 lower-case hex. Raw emails and phones never leave CIRQLIN. A page
 * holds up to 10,000 entries; `has_more` (or a full page) means read again
 * from the returned cursor.
 *
 * The endpoint is being built in the CIRQLIN repo. Until it answers, a 404,
 * 405 or 501 reads `not_available` and the sync leaves every row as it was.
 *
 * Never throws. Never logs. A result carries counts and reasons only: the
 * hashes live in `page.added` / `page.removed`, in memory, for the upload.
 *
 * Pure apart from the injected fetch. No `@/` imports, so node --test loads it.
 */

export const CIRQLIN_DEFAULT_API_BASE = "https://app.cirqlin.com";
export const CIRQLIN_HASHED_PATH = "/api/partner/signups/hashed";
export const CIRQLIN_HASHED_TIMEOUT_MS = 20_000;
/** The spec's page size; also Meta's batch size for /users. */
export const CIRQLIN_PAGE_MAX = 10_000;

export type ConsentScope = "show" | "promoter";

export type HashedEntry = { em?: string; ph?: string };

export type HashedCounts = { consented_show: number; consented_promoter: number; not_consented: number };

export type HashedPage = {
  cursor: string | null;
  added: HashedEntry[];
  removed: HashedEntry[];
  counts: HashedCounts | null;
  hasMore: boolean;
};

export type HashedReadFailure = {
  ok: false;
  /** not_available: the endpoint isn't live (404/405/501). */
  reason: "not_available" | "not_configured" | "unauthorized" | "http_error" | "timeout" | "network" | "bad_shape" | "no_tag";
  status?: number;
};

export type HashedReadResult = { ok: true; page: HashedPage } | HashedReadFailure;

export type HashedReader = (args: { tag: string; scope: ConsentScope; since: string | null }) => Promise<HashedReadResult>;

const HEX64 = /^[0-9a-f]{64}$/;

function isEntry(value: unknown): value is HashedEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const em = v.em;
  const ph = v.ph;
  if (em != null && (typeof em !== "string" || !HEX64.test(em))) return false;
  if (ph != null && (typeof ph !== "string" || !HEX64.test(ph))) return false;
  return em != null || ph != null;
}

function isCounts(value: unknown): value is HashedCounts {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return ["consented_show", "consented_promoter", "not_consented"].every((k) => Number.isFinite(v[k]));
}

/** The body, or null when it isn't the spec's shape. An entry that isn't 64-hex fails the whole page: half a page is never sent. */
export function parseHashedPage(body: unknown): HashedPage | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const v = body as Record<string, unknown>;
  if (v.cursor != null && typeof v.cursor !== "string") return null;
  if (!Array.isArray(v.added) || !Array.isArray(v.removed)) return null;
  if (!v.added.every(isEntry) || !v.removed.every(isEntry)) return null;
  if (v.counts != null && !isCounts(v.counts)) return null;
  const size = v.added.length + v.removed.length;
  return {
    cursor: (v.cursor as string | null | undefined) ?? null,
    added: (v.added as HashedEntry[]).map((e) => ({ ...(e.em ? { em: e.em } : {}), ...(e.ph ? { ph: e.ph } : {}) })),
    removed: (v.removed as HashedEntry[]).map((e) => ({ ...(e.em ? { em: e.em } : {}), ...(e.ph ? { ph: e.ph } : {}) })),
    counts: (v.counts as HashedCounts | undefined) ?? null,
    hasMore: v.has_more === true || (v.has_more == null && size >= CIRQLIN_PAGE_MAX),
  };
}

export function hashedUrl(base: string, args: { tag: string; scope: ConsentScope; since: string | null }): string {
  const url = new URL(CIRQLIN_HASHED_PATH, base);
  url.searchParams.set("crm_base_tag", args.tag);
  url.searchParams.set("scope", args.scope);
  if (args.since) url.searchParams.set("since", args.since);
  return url.toString();
}

/** A reader bound to the env (or the given secret and base). */
export function cirqlinHashedReader(opts?: {
  base?: string;
  secret?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}): HashedReader {
  const env = opts?.env ?? process.env;
  return async ({ tag, scope, since }) => {
    const trimmed = tag.trim();
    if (!trimmed) return { ok: false, reason: "no_tag" };
    const secret = (opts?.secret ?? env.CIRQLIN_PARTNER_READ_SECRET ?? "").trim();
    if (!secret) return { ok: false, reason: "not_configured" };
    const base = (opts?.base ?? env.CIRQLIN_API_BASE ?? CIRQLIN_DEFAULT_API_BASE).trim() || CIRQLIN_DEFAULT_API_BASE;
    const fetchImpl = opts?.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await fetchImpl(hashedUrl(base, { tag: trimmed, scope, since }), {
        method: "GET",
        headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(opts?.timeoutMs ?? CIRQLIN_HASHED_TIMEOUT_MS),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      return { ok: false, reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
    }
    if (res.status === 404 || res.status === 405 || res.status === 501) return { ok: false, reason: "not_available", status: res.status };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorized", status: res.status };
    if (!res.ok) return { ok: false, reason: "http_error", status: res.status };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: "bad_shape", status: res.status };
    }
    const page = parseHashedPage(body);
    return page ? { ok: true, page } : { ok: false, reason: "bad_shape", status: res.status };
  };
}
