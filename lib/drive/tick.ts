/**
 * One pass of the Drive export (the creative-lab-drive-tick cron, every 5
 * minutes). In order, each step independent of the others' failures:
 *
 *   1. trees — a client or event created since AUTO_TREE_FROM gets its tree
 *      (S19). Older events get one from the backfill or "Set up Drive" (S24).
 *   2. upkeep — every event with a tree: renamed or re-dated → its folder is
 *      renamed (S19); folders missing from the map are added (a linked folder,
 *      S24), and one Artist clips/{artist} folder per lineup artist (S22). The
 *      map answers without a Drive call when nothing changed.
 *   3. cycles — an on-sale event's current w/c {d Mon} folder (S19, HS13).
 *   4. cancelled — the folder gains " (cancelled)"; nothing deleted (S27).
 *   5. filing — up to maxFiles approved renders (S20, HS9).
 *   6. winners — judged rounds' winners (S21, HS19).
 *
 * Archived clients get nothing (S27). Writes only to Drive and to the
 * migration-218 columns; never to a render's status.
 */

import { isArchivedClientStatus } from "../db/client-status.ts";
import type { DriveApi } from "./client.ts";
import { fileRender, markWinners, wantsFiling, type FileResult, type StorageDownload, type WinnerResult } from "./filing.ts";
import { allRows, type DriveDb, type RowOf } from "./db.ts";
import { emptyLog, ensureArtistFolders, ensureClientTree, ensureCycleFolder, ensureEventTree, markCancelled, renameOwnerFolders, type TreeLog } from "./folders.ts";
import { loadLineupArtists } from "./lineup.ts";
import { ownerNameResolver } from "./owner.ts";

export { allRows } from "./db.ts";
import { cycleDue, isCancelled, londonToday, type CycleCalendar } from "./tree.ts";


/** Clients and events created from this day get their tree automatically (the day this PR's migration is written). */
export const AUTO_TREE_FROM = "2026-11-09T00:00:00Z";

export type DriveTickResult = {
  ok: true;
  today: string;
  trees: { clients: number; events: number };
  renamed: string[];
  cycles: string[];
  cancelled: number;
  filed: FileResult[];
  winners: WinnerResult[];
  created: string[];
  errors: string[];
};

export function onSaleFrom(event: Pick<RowOf<"events">, "general_sale_at">): string | null {
  const at = event.general_sale_at ? String(event.general_sale_at) : null;
  return at ? londonToday(new Date(at)) : null;
}

export function isPast(event: Pick<RowOf<"events">, "event_date">, today: string): boolean {
  const day = event.event_date ? String(event.event_date).slice(0, 10) : null;
  return Boolean(day && day < today);
}

export async function runDriveTick(
  db: DriveDb,
  drive: DriveApi,
  opts: { download: StorageDownload; now?: Date; calendar?: CycleCalendar; maxFiles?: number; autoTreeFrom?: string },
): Promise<DriveTickResult> {
  const now = opts.now ?? new Date();
  const today = londonToday(now);
  const since = opts.autoTreeFrom ?? AUTO_TREE_FROM;
  const log: TreeLog = emptyLog();
  const errors: string[] = [];
  const result: DriveTickResult = { ok: true, today, trees: { clients: 0, events: 0 }, renamed: [], cycles: [], cancelled: 0, filed: [], winners: [], created: [], errors };
  const attempt = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      errors.push(`${label}: ${(err instanceof Error ? err.message : String(err)).replace(/https?:\/\/\S+/g, "").slice(0, 300)}`);
    }
  };

  const clients = await allRows(db, "clients");
  const byId = new Map(clients.map((client) => [String(client.id), client]));
  const events = await allRows(db, "events");
  const live = (client: RowOf<"clients"> | undefined): client is RowOf<"clients"> => Boolean(client) && !isArchivedClientStatus(client!.status);

  // 1. trees for what was created since the cutover
  for (const client of clients) {
    if (!live(client) || client.drive_folder_id || String(client.created_at ?? "") < since) continue;
    await attempt(`client ${client.name}`, async () => {
      if (await ensureClientTree(db, drive, client, log)) result.trees.clients += 1;
    });
  }
  for (const event of events) {
    const client = byId.get(String(event.client_id));
    if (!live(client) || event.drive_folder_id || isCancelled(event.status) || isPast(event, today) || String(event.created_at ?? "") < since) continue;
    await attempt(`event ${event.event_code ?? event.name}`, async () => {
      const made = await ensureEventTree(db, drive, event, client, log);
      if (made.folderId) result.trees.events += 1;
    });
  }

  // 2–4. upkeep, cycles, cancelled
  for (const event of events) {
    const client = byId.get(String(event.client_id));
    if (!live(client) || !event.drive_folder_id) continue;
    if (isCancelled(event.status)) {
      await attempt(`cancel ${event.event_code ?? event.name}`, async () => {
        if (await markCancelled(db, drive, event, log)) result.cancelled += 1;
      });
      continue;
    }
    if (isPast(event, today)) continue;
    await attempt(`upkeep ${event.event_code ?? event.name}`, async () => {
      await ensureEventTree(db, drive, event, client, log);
      // Artist clips/{artist} for each lineup artist (S22): made with the tree, and again when the lineup changes.
      await ensureArtistFolders(db, drive, event, client, await loadLineupArtists(db, event.id), log);
      // Owner folders follow a Lab or client rename, in every stage and cycle (D5). Map-only unless a name changed.
      await renameOwnerFolders(db, drive, event, client, await ownerNameResolver(db, event, client), log);
    });
    const monday = cycleDue({ today, onSale: String(event.status ?? "") === "on_sale", onSaleFrom: onSaleFrom(event), eventDate: event.event_date ?? null, calendar: opts.calendar });
    if (monday) {
      await attempt(`cycle ${event.event_code ?? event.name}`, async () => {
        const before = log.created.length;
        await ensureCycleFolder(db, drive, event, client, monday, log);
        if (log.created.length > before) result.cycles.push(`${event.event_code ?? event.name} w/c ${monday}`);
      });
    }
  }

  // 5. filing
  const renders = (await allRows(db, "creative_lab_renders")).filter((render) => wantsFiling(render, now));
  renders.sort((a, b) => String(a.updated_at ?? a.created_at ?? "").localeCompare(String(b.updated_at ?? b.created_at ?? "")));
  let filed = 0;
  for (const render of renders) {
    if (filed >= (opts.maxFiles ?? 4)) break;
    await attempt(`render ${render.id}`, async () => {
      const outcome = await fileRender(db, drive, render, { download: opts.download, now, today, calendar: opts.calendar, log });
      if (!("skipped" in outcome)) {
        result.filed.push(outcome);
        filed += 1;
      }
    });
  }

  // 6. winners
  const judged = (await allRows(db, "creative_lab_rounds")).filter((round) => round.status === "judged");
  for (const round of judged) {
    await attempt(`winners ${round.id}`, async () => {
      result.winners.push(...(await markWinners(db, drive, round, log)));
    });
  }

  result.renamed = log.renamed;
  result.created = log.created;
  return result;
}

/** A cron_runs row only when something happened or failed: a quiet tick is not a heartbeat. */
export function driveTickShouldRecord(result: Pick<DriveTickResult, "created" | "renamed" | "filed" | "winners" | "errors" | "cancelled">): boolean {
  return result.created.length + result.renamed.length + result.filed.length + result.winners.length + result.errors.length + result.cancelled > 0;
}
