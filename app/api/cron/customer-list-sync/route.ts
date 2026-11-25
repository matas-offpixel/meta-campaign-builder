import { NextResponse, type NextRequest } from "next/server";

import { cirqlinHashedReader } from "@/lib/customer-lists/cirqlin-hashed";
import { liveCustomerListGraph } from "@/lib/customer-lists/graph-live";
import { customerListWritesEnabled, isEightLondon } from "@/lib/customer-lists/rules";
import { loadEnabledRows, runCustomerListSync, workForRows, type Db } from "@/lib/customer-lists/sync";
import { venueAccountOf } from "@/lib/customer-lists/venue";
import type { ReplicateDb } from "@/lib/replicate/load";
import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/cron/customer-list-sync
 *
 * Signups into Meta (SU1; scratch/campaign-replicate/signups-to-meta.md,
 * CIRQLIN's hashed read cirqlin #682). For every enabled customer_list_syncs
 * row (written per event by scripts/customer-list-sync.mts --enable, never
 * here): from presale day 08:00 London (general sale with no presale) to
 * show day, the show's "{code} · Signups" list is made if it isn't there and
 * kept current from CIRQLIN's consented signups (scope=show, as hashes):
 * daily adds and removes by cursor, and a full replace on the Monday run
 * (usersreplace), which drops GDPR erasures. The list also joins its audience
 * templates. No other list is written. lib/customer-lists/sync.ts has the rules.
 *
 * vercel.json runs "0 7,8 * * *" (UTC) and the sync acts on the one that is
 * 08:00 London; `?force=1` runs it whatever the hour, `?event=CODE` narrows it.
 *
 * Killswitch: `OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED` must be exactly
 * "true". Anything else responds 200 with `skippedReason: "killswitch"`
 * before any read. Every Meta write is on meta_write_idempotency
 * (`customer_list_create`, `customer_list_users`, migration 267) with
 * `{ required: true }`. Archived clients are skipped. The response and the
 * log carry counts, list ids and reasons, never a hash.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim() === expected.trim();
  return header.trim() === expected.trim();
}

async function handleGET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!customerListWritesEnabled(process.env)) return NextResponse.json({ ok: true, skippedReason: "killswitch" }, { status: 200 });
  const now = new Date();
  if (req.nextUrl.searchParams.get("force") !== "1" && !isEightLondon(now)) return NextResponse.json({ ok: true, skippedReason: "not_08_london" }, { status: 200 });
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "META_ACCESS_TOKEN is not configured" }, { status: 500 });
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Service-role client unavailable" }, { status: 500 });
  }
  const eventCodes = req.nextUrl.searchParams.getAll("event").map((code) => code.trim()).filter(Boolean);
  try {
    // Cast the typed client once: checking it structurally against Db and
    // ReplicateDb at each call is "excessively deep" for tsc (next build).
    const db = supabase as unknown as Db;
    const venueDb = supabase as unknown as ReplicateDb;
    const rows = await loadEnabledRows(db);
    const work = await workForRows(db, rows, (e) => venueAccountOf(venueDb, e), eventCodes.length ? eventCodes : undefined);
    const result = await runCustomerListSync(
      { db, graph: liveCustomerListGraph(token), readHashed: cirqlinHashedReader(), env: process.env, now, mode: "write" },
      work,
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[customer-list-sync] unhandled error: ${message.replace(/[0-9a-fA-F]{64}/g, "[hash]")}`);
    return NextResponse.json({ ok: false, error: message.replace(/[0-9a-fA-F]{64}/g, "[hash]") }, { status: 500 });
  }
}

type RowCounts = { outcome?: string; added?: number; removed?: number; replaced?: number };

function rowList(b: Record<string, unknown>): RowCounts[] {
  return Array.isArray(b.rows) ? (b.rows as RowCounts[]) : [];
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export const GET = withCronRunLog(
  {
    cronName: "customer-list-sync",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (b) => rowList(b).filter((r) => r.outcome === "sent" || r.outcome === "replaced").length,
    considered: (b) => rowList(b).length,
    detail: (b) => ({
      events: num(b.events),
      lists: rowList(b).length,
      added: rowList(b).reduce((s, r) => s + num(r.added), 0),
      removed: rowList(b).reduce((s, r) => s + num(r.removed), 0),
      replaced: rowList(b).reduce((s, r) => s + num(r.replaced), 0),
      outcomes: rowList(b).map((r) => r.outcome ?? "unknown"),
      metaReads: num(b.metaReads),
      metaWrites: num(b.metaWrites),
      cirqlinReads: num(b.cirqlinReads),
      skippedReason: typeof b.skippedReason === "string" ? b.skippedReason : null,
    }),
  },
  handleGET,
);
