/**
 * POST /api/meta/interest-validate
 *
 * Body:
 *   {
 *     items: Array<{ id?: string; name: string }>
 *   }
 *
 * Resolves each item against Meta's live ad-interest database via
 * `GET /search?type=adinterest&q={name}`. For each item:
 *
 *   - If a row's name matches the requested name (case-insensitive, trimmed),
 *     the item is `valid` and we return the canonical Meta id/name/size/path.
 *     Caller is expected to swap in the canonical id.
 *   - Otherwise the item is `unresolved` and we return up to 5 nearby
 *     candidates as `replacements` so the UI can offer a swap.
 *
 * This is the additive, non-launch counterpart to `sanitiseInterests` in
 * `lib/meta/adset.ts`. It exists so the wizard can validate a single chip
 * (or a small batch) without running the full launch pipeline.
 *
 * Auth: requires the same Supabase session as the rest of /api/meta/*.
 * Network: one upstream Meta request per unique name (de-duped). Safe but
 * not free — callers should batch.
 */

import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import type {
  InterestValidateRequestItem,
  InterestValidateResponse,
  InterestValidateResult,
  InterestValidateResultMeta,
} from "@/lib/interest-targetability";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;
const PER_QUERY_LIMIT = 10;
const MAX_ITEMS_PER_REQUEST = 50;
const MAX_REPLACEMENTS = 5;

interface RawMetaInterestRow {
  id: string;
  name: string;
  audience_size?: number;
  path?: string[];
}

function normalise(name: string): string {
  return name.trim().toLowerCase();
}

async function searchInterestByName(
  name: string,
  token: string,
): Promise<RawMetaInterestRow[]> {
  const url = new URL(`${BASE}/search`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("type", "adinterest");
  url.searchParams.set("q", name);
  url.searchParams.set("limit", String(PER_QUERY_LIMIT));

  let res: Response;
  try {
    res = await fetch(url.toString(), { cache: "no-store" });
  } catch (err) {
    console.error("[/api/meta/interest-validate] Network error:", err);
    return [];
  }

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    return [];
  }

  if (!res.ok || json.error) {
    console.error(
      `[/api/meta/interest-validate] Meta error for q="${name}":`,
      JSON.stringify(json.error ?? {}),
    );
    return [];
  }

  return ((json.data as RawMetaInterestRow[]) ?? []).filter(
    (r) => typeof r?.id === "string" && typeof r?.name === "string",
  );
}

function toMeta(row: RawMetaInterestRow): InterestValidateResultMeta {
  return {
    id: row.id,
    name: row.name,
    audienceSize: row.audience_size,
    path: row.path,
  };
}

function resolveSingle(
  requested: InterestValidateRequestItem,
  rows: RawMetaInterestRow[],
  checkedAt: string,
): InterestValidateResult {
  const wantedName = normalise(requested.name);
  const wantedId = requested.id?.trim();

  // 1. Strongest signal: exact id match (caller already has a Meta id).
  if (wantedId && /^\d{10,}$/.test(wantedId)) {
    const idHit = rows.find((r) => r.id === wantedId);
    if (idHit) {
      return {
        name: requested.name,
        requestedId: requested.id,
        targetabilityStatus: "valid",
        meta: toMeta(idHit),
        checkedAt,
      };
    }
  }

  // 2. Exact (case-insensitive) name match — preferred resolution path.
  const exact = rows.find((r) => normalise(r.name) === wantedName);
  if (exact) {
    return {
      name: requested.name,
      requestedId: requested.id,
      targetabilityStatus: "valid",
      meta: toMeta(exact),
      checkedAt,
    };
  }

  // 3. No exact match — return nearby candidates for UI swap suggestions.
  const replacements = rows.slice(0, MAX_REPLACEMENTS).map(toMeta);
  return {
    name: requested.name,
    requestedId: requested.id,
    targetabilityStatus: "unresolved",
    replacements,
    checkedAt,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let body: { items?: InterestValidateRequestItem[] };
  try {
    body = (await req.json()) as { items?: InterestValidateRequestItem[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    const empty: InterestValidateResponse = { results: [] };
    return NextResponse.json(empty);
  }
  if (items.length > MAX_ITEMS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Too many items — max ${MAX_ITEMS_PER_REQUEST} per request` },
      { status: 400 },
    );
  }

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
    console.info(`[interest-validate] token: source=${resolved.source} prefix=${token.slice(0, 12)}…`);
  } catch (err) {
    console.error("[interest-validate] no Meta access token:", err);
    return NextResponse.json(
      { error: "No Facebook access token available. Connect your Facebook account in Account Setup." },
      { status: 401 },
    );
  }

  // De-dupe upstream lookups by normalised name; one Meta call per unique name.
  const uniqueNames = new Map<string, string>();
  for (const item of items) {
    const name = (item.name ?? "").trim();
    if (name.length === 0) continue;
    const key = normalise(name);
    if (!uniqueNames.has(key)) uniqueNames.set(key, name);
  }

  const lookups = await Promise.all(
    Array.from(uniqueNames.entries()).map(async ([key, displayName]) => {
      const rows = await searchInterestByName(displayName, token);
      return [key, rows] as const;
    }),
  );
  const rowsByName = new Map<string, RawMetaInterestRow[]>(lookups);
  const checkedAt = new Date().toISOString();

  const results: InterestValidateResult[] = items.map((item) => {
    const name = (item.name ?? "").trim();
    if (name.length === 0) {
      return {
        name: item.name ?? "",
        requestedId: item.id,
        targetabilityStatus: "unresolved",
        replacements: [],
        checkedAt,
      };
    }
    const rows = rowsByName.get(normalise(name)) ?? [];
    return resolveSingle({ ...item, name }, rows, checkedAt);
  });

  const response: InterestValidateResponse = { results };
  return NextResponse.json(response);
}
