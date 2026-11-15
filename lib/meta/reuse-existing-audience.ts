import { withActPrefix } from "./ad-account-id.ts";

/**
 * Fields for GET /{adAccountId}/customaudiences.
 *
 * `rule` is how engagement, video, and website audiences are compared.
 * `lookalike_spec` is requested because lookalike creates have no `rule`
 * (subtype LOOKALIKE, origin_audience_id, lookalike_spec). The approximate
 * count fields stay so the audience picker does not lose size.
 * This is a field extension on the existing read. It does not write to Meta.
 */
export const META_CUSTOM_AUDIENCE_LIST_FIELDS = [
  "id",
  "name",
  "subtype",
  "approximate_count_lower_bound",
  "approximate_count_upper_bound",
  "rule",
  "lookalike_spec",
].join(",");

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;
const MAX_LIST_PAGES = 25;

export interface ListedMetaCustomAudience {
  id: string;
  name?: string;
  subtype?: string;
  approximate_count_lower_bound?: number;
  approximate_count_upper_bound?: number;
  rule?: unknown;
  lookalike_spec?: unknown;
  /** Present when a caller already has it. The list read stores origin inside lookalike_spec. */
  origin_audience_id?: string | number;
}

export type MetaGraphFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export interface ReuseOrCreateResult {
  metaAudienceId: string;
  reused: boolean;
}

/**
 * List the ad account's custom audiences and return the first one whose rule
 * (or lookalike spec) matches `payload`. `create` runs only when nothing matches,
 * so a hit does not POST /customaudiences and does not write an idempotency row.
 */
export async function reuseOrCreateCustomAudience(args: {
  payload: Record<string, string>;
  existing: ListedMetaCustomAudience[];
  create: () => Promise<string>;
}): Promise<ReuseOrCreateResult> {
  const hit = matchExistingCustomAudience(args.payload, args.existing);
  if (hit) return { metaAudienceId: hit.id, reused: true };
  return { metaAudienceId: await args.create(), reused: false };
}

/**
 * First audience whose rule or lookalike spec matches the payload that would
 * be posted. A shared name is not a match. Payloads with neither `rule` nor
 * `lookalike_spec` (customer lists) are never reused.
 */
export function matchExistingCustomAudience(
  payload: Record<string, string>,
  existing: ListedMetaCustomAudience[],
): ListedMetaCustomAudience | null {
  const ruleText = typeof payload.rule === "string" ? payload.rule.trim() : "";
  if (ruleText) {
    const want = parseJsonValue(ruleText);
    if (want === undefined) return null;
    for (const item of existing) {
      if (!item?.id) continue;
      const got = parseJsonValue(item.rule);
      if (got === undefined) continue;
      if (stableEqual(want, got)) return item;
    }
    return null;
  }

  const specText =
    typeof payload.lookalike_spec === "string" ? payload.lookalike_spec.trim() : "";
  const origin = payload.origin_audience_id?.trim() ?? "";
  if (!specText || !origin) return null;
  if ((payload.subtype ?? "").toUpperCase() !== "LOOKALIKE") return null;
  const wantSpec = parseJsonValue(specText);
  if (wantSpec === undefined) return null;

  for (const item of existing) {
    if (!item?.id) continue;
    if ((item.subtype ?? "").toUpperCase() !== "LOOKALIKE") continue;
    const itemOrigin = listedLookalikeOrigin(item);
    if (itemOrigin !== origin) continue;
    const gotSpec = parseJsonValue(item.lookalike_spec);
    if (gotSpec === undefined) continue;
    if (lookalikeSpecsMatch(wantSpec, gotSpec)) return item;
  }
  return null;
}

/**
 * GET /{adAccountId}/customaudiences with {@link META_CUSTOM_AUDIENCE_LIST_FIELDS}.
 * `fetchImpl` is injected so tests never call Graph. The access token is a query
 * param and is not logged.
 */
export async function listAccountCustomAudiences(
  adAccountId: string,
  token: string,
  fetchImpl: MetaGraphFetch,
): Promise<ListedMetaCustomAudience[]> {
  const collected: ListedMetaCustomAudience[] = [];
  let nextUrl: string | null = customAudiencesUrl(adAccountId, token);

  for (let page = 0; page < MAX_LIST_PAGES && nextUrl; page++) {
    const response = await fetchImpl(nextUrl, { cache: "no-store" });
    const json = (await response.json().catch(() => null)) as {
      data?: ListedMetaCustomAudience[];
      paging?: { next?: string };
      error?: { message?: string };
    } | null;
    if (!json || !response.ok || json.error) {
      const message = json?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(message);
    }
    for (const item of json.data ?? []) {
      if (item?.id) collected.push(item);
    }
    nextUrl = json.paging?.next ?? null;
  }
  return collected;
}

function customAudiencesUrl(adAccountId: string, token: string): string {
  const url = new URL(`${BASE}/${withActPrefix(adAccountId)}/customaudiences`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", META_CUSTOM_AUDIENCE_LIST_FIELDS);
  url.searchParams.set("limit", "200");
  return url.toString();
}

function listedLookalikeOrigin(item: ListedMetaCustomAudience): string | null {
  if (item.origin_audience_id != null && String(item.origin_audience_id).trim()) {
    return String(item.origin_audience_id).trim();
  }
  const spec = parseJsonValue(item.lookalike_spec);
  if (!spec || typeof spec !== "object") return null;
  const origin = (spec as { origin?: unknown }).origin;
  const entries = Array.isArray(origin) ? origin : origin != null ? [origin] : [];
  for (const entry of entries) {
    if (entry && typeof entry === "object" && "id" in entry) {
      const id = (entry as { id?: unknown }).id;
      if (id != null && String(id).trim()) return String(id).trim();
    } else if (typeof entry === "string" || typeof entry === "number") {
      if (String(entry).trim()) return String(entry).trim();
    }
  }
  return null;
}

/**
 * Full structural equality, or equality of every key the create payload sends.
 * Meta's read of lookalike_spec adds read-only keys such as `origin`; those
 * must not hide a spec that matches type, ratio, and country.
 */
function lookalikeSpecsMatch(want: unknown, got: unknown): boolean {
  if (stableEqual(want, got)) return true;
  if (!isPlainObject(want) || !isPlainObject(got)) return false;
  const keys = Object.keys(want);
  if (keys.length === 0) return false;
  return keys.every((key) => stableEqual(want[key], got[key]));
}

function stableEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function parseJsonValue(value: unknown): unknown | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      // Graph encodes page and Instagram ids as JSON numbers. Many are wider
      // than Number.MAX_SAFE_INTEGER, so quote them before parse and compare
      // them as strings. Short ids still coerce in canonicalize.
      const protectedIds = trimmed.replace(
        /([:\[,]\s*)(-?\d{16,})(\s*[,}\]])/g,
        '$1"$2"$3',
      );
      return JSON.parse(protectedIds) as unknown;
    } catch {
      return undefined;
    }
  }
  if (value === null || value === undefined) return undefined;
  if (typeof value === "object") return value;
  return undefined;
}

/**
 * Graph returns event-source ids as numbers. The create payload sends the same
 * ids as strings. Comparing the parsed values would miss otherwise, and the
 * next builder run would create another copy.
 */
function canonicalize(value: unknown): unknown {
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isSafeInteger(n) && String(n) === value) return n;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return stringifyStable(canonicalize(value));
}

function stringifyStable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stringifyStable).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stringifyStable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
