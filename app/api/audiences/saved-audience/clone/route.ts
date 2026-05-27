/**
 * POST /api/audiences/saved-audience/clone
 *
 * Body:
 *   {
 *     sourceAdAccountId: string,   // "act_…" or bare numeric
 *     destAdAccountId:   string,   // "act_…" or bare numeric
 *     savedAudienceIds:  string[]  // ids on the source account
 *   }
 *
 * For each selected Saved Audience on the source account, POST an identical
 * spec to the destination account. Underlying Custom Audience IDs are
 * preserved verbatim — they resolve on the destination because the BM
 * partner-shares them at Manage level. If the BM share isn't in place, Meta
 * rejects the POST with a permission error; we surface that per-cell.
 *
 * Per-cell try/catch: a single duplicate-name or permission error doesn't
 * abort the batch. Concurrency: 2 cells in flight (same #80004 budget the
 * lookalike + bulk-page builders use).
 */

import { NextResponse, type NextRequest } from "next/server";

import { normalizeAdAccountId } from "@/lib/meta/ad-account";
import { MetaApiError } from "@/lib/meta/client";
import {
  createSavedAudienceOnDestination,
  listSavedAudienceNames,
  listSavedAudiencesWithTargeting,
  type SavedAudienceWithTargeting,
} from "@/lib/meta/saved-audience";
import {
  classifyCloneError,
  type CloneFailureReason,
} from "@/lib/meta/saved-audience-pure";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Same budget the lookalike + bulk audience builders use (#80004 headroom). */
const CELL_CONCURRENCY = 2;

interface CloneRequestBody {
  sourceAdAccountId?: unknown;
  destAdAccountId?: unknown;
  savedAudienceIds?: unknown;
}

interface CellSuccess {
  sourceId: string;
  name: string;
  destMetaAudienceId: string;
}

interface CellFailure {
  sourceId: string;
  name: string;
  reason: CloneFailureReason;
  message: string;
  code: number | null;
}

interface ParsedBody {
  sourceAdAccountId: string;
  destAdAccountId: string;
  savedAudienceIds: string[];
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as CloneRequestBody | null;
  const parsed = parseBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Facebook session expired or not connected. Reconnect Facebook in Account Setup, then try again.",
        code: 190,
      },
      { status: 401 },
    );
  }

  const { sourceAdAccountId, destAdAccountId, savedAudienceIds } = parsed.body;

  // ── Step 1: fetch source specs (full targeting) + destination names. ──
  let sourceAudiences: SavedAudienceWithTargeting[];
  let destExistingNames: Set<string>;
  try {
    [sourceAudiences, destExistingNames] = await Promise.all([
      listSavedAudiencesWithTargeting(token, sourceAdAccountId),
      listSavedAudienceNames(token, destAdAccountId),
    ]);
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.code === 190 || err.code === 102) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Facebook session expired. Reconnect Facebook in Account Setup, then retry.",
            code: err.code,
          },
          { status: 401 },
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error: err.userMsg ?? err.message,
          code: err.code ?? null,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load Saved Audiences",
      },
      { status: 500 },
    );
  }

  const sourceById = new Map(sourceAudiences.map((a) => [a.id, a]));

  // ── Step 2: build cell list. Pre-fail unknown ids + missing targeting +
  //           duplicate-name collisions before any POSTs. ───────────────────
  const successes: CellSuccess[] = [];
  const failures: CellFailure[] = [];
  const cellsToWrite: SavedAudienceWithTargeting[] = [];

  for (const id of savedAudienceIds) {
    const source = sourceById.get(id);
    if (!source) {
      failures.push({
        sourceId: id,
        name: id,
        reason: "unknown",
        message:
          "Saved Audience not found on source account. Reload and try again.",
        code: null,
      });
      continue;
    }
    if (!source.targeting || typeof source.targeting !== "object") {
      failures.push({
        sourceId: id,
        name: source.name,
        reason: "missing_targeting",
        message:
          "Source Saved Audience has no targeting spec — Meta returned an empty `targeting` field.",
        code: null,
      });
      continue;
    }
    if (destExistingNames.has(source.name)) {
      failures.push({
        sourceId: id,
        name: source.name,
        reason: "duplicate_name",
        message:
          "An audience with this name already exists on the destination account.",
        code: null,
      });
      continue;
    }
    cellsToWrite.push(source);
  }

  // ── Step 3: write cells with bounded concurrency. ─────────────────────────
  let cursor = 0;
  async function worker() {
    while (cursor < cellsToWrite.length) {
      const idx = cursor++;
      const cell = cellsToWrite[idx]!;
      try {
        const created = await createSavedAudienceOnDestination(
          token,
          destAdAccountId,
          {
            name: cell.name,
            description: cell.description,
            targeting: cell.targeting,
          },
        );
        successes.push({
          sourceId: cell.id,
          name: cell.name,
          destMetaAudienceId: created.id,
        });
      } catch (err) {
        const code = err instanceof MetaApiError ? (err.code ?? null) : null;
        const message =
          err instanceof MetaApiError
            ? (err.userMsg ?? err.message)
            : err instanceof Error
              ? err.message
              : String(err);
        failures.push({
          sourceId: cell.id,
          name: cell.name,
          reason: classifyCloneError({ code, message }),
          message,
          code,
        });
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(CELL_CONCURRENCY, cellsToWrite.length) },
      worker,
    ),
  );

  return NextResponse.json({ ok: true, successes, failures });
}

function parseBody(
  body: CloneRequestBody | null,
): { ok: true; body: ParsedBody } | { ok: false; error: string } {
  const sourceRaw =
    typeof body?.sourceAdAccountId === "string" ? body.sourceAdAccountId : "";
  const destRaw =
    typeof body?.destAdAccountId === "string" ? body.destAdAccountId : "";
  const ids = Array.isArray(body?.savedAudienceIds)
    ? body.savedAudienceIds.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  const sourceAdAccountId = normalizeAdAccountId(sourceRaw);
  const destAdAccountId = normalizeAdAccountId(destRaw);
  if (!sourceAdAccountId) {
    return { ok: false, error: "sourceAdAccountId must be numeric (optionally prefixed 'act_')" };
  }
  if (!destAdAccountId) {
    return { ok: false, error: "destAdAccountId must be numeric (optionally prefixed 'act_')" };
  }
  if (sourceAdAccountId === destAdAccountId) {
    return {
      ok: false,
      error: "Source and destination ad accounts must be different.",
    };
  }
  if (ids.length === 0) {
    return { ok: false, error: "Pick at least one Saved Audience to clone." };
  }
  // Defensive dedup — UI shouldn't send duplicates but the API must not double-POST.
  const dedupedIds = Array.from(new Set(ids));

  return {
    ok: true,
    body: {
      sourceAdAccountId,
      destAdAccountId,
      savedAudienceIds: dedupedIds,
    },
  };
}
