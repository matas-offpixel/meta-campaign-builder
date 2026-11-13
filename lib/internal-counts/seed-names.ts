/**
 * lib/internal-counts/seed-names.ts
 *
 * The sheet names Matas confirmed on #1217 (13 Nov, 19:25): 16 names that
 * are events and 8 that are "Not a show we run". The seed writes them the
 * way the review list would, through `decideName` (lib/internal-counts/
 * resolve.ts), and adds the 16 to #1218's `event_count_aliases` (migration
 * 235: event_id, alias; unique on alias).
 *
 * The ingest reads event_count_aliases (loadCountAliasMap), the same table
 * the event page edits; `decideName` writes it and internal_count_show_names.
 *
 * Planning reads only. Events resolve by event_code: a code with no event,
 * or more than one, fails the whole plan and nothing is written. An alias
 * already in event_count_aliases for the same event is left as it is; one
 * pointing at a different event is a conflict, reported and not written.
 */

import { loadCountAliasMap } from "../event-config/aliases.ts";
import type { Db, RunContext } from "./context.ts";
import { decideName, type Resolver } from "./resolve.ts";

/** Exact spelling and case, as the sheets write them → event_code. */
export const CONFIRMED_SHEET_ALIASES: Readonly<Record<string, string>> = {
  IPC: "NX26-IPC",
  "EAST END DUBS": "NX26-EED",
  "D.O.D": "NX26-DOD",
  SCHAK: "NX26-SCHAK",
  RUDIMENTAL: "NX26-RUDIMENTAL",
  "AZYR B2B PARTI": "NX26-AZYR",
  "ROBBIE DOHERTY": "NX26-ROBBIEDOHERTY",
  "FEVER 105": "ES26-FEVER105",
  "MODERN FUNKTION": "NX26-MF",
  "GIRLS DON'T SYNC": "ES26-GDS",
  FOLAMOUR: "NX26-FOLAMOUR",
  Folamour: "NX26-FOLAMOUR",
  KREAM: "EBR26-KREAM",
  "DJ EZ": "NX26-DJEZ",
  "Julian Fijma": "NX27-JULIANFIJMA",
  LOCKLEAD: "NX26-LOCKLEAD",
};

/** "Not a show we run": never asked again; their sale sentences resolve with them. */
export const CONFIRMED_NOT_OURS: readonly string[] = [
  "CHICANE",
  "ENZO SIRAGUSA",
  "DUSKY BRIS",
  "DAVE PEARCE",
  "SKIN ON SKIN",
  "DUSKY SHEFF",
  "KID FRAN",
  "NORA EN PURE",
];

export interface SeedPlan {
  aliases: Array<{ alias: string; eventCode: string; eventId: string; state: "new" | "already" | "conflict"; existingEventId?: string }>;
  notOurs: Array<{ name: string; state: "new" | "already" }>;
}

export class SeedError extends Error {}

async function requireAliasTable(sb: Db): Promise<void> {
  const { error } = await sb.from("event_count_aliases").select("alias").limit(1);
  if (error) {
    throw new SeedError(
      `event_count_aliases isn't readable (${error.code ?? "error"}: ${error.message}). Apply migrations 234 and 235 first.`,
    );
  }
}

/** Read-only: what applying would write. Throws on any code that doesn't resolve to exactly one event. */
export async function planSeed(
  sb: Db,
  aliases: Readonly<Record<string, string>> = CONFIRMED_SHEET_ALIASES,
  notOurs: readonly string[] = CONFIRMED_NOT_OURS,
): Promise<SeedPlan> {
  await requireAliasTable(sb);
  const codes = [...new Set(Object.values(aliases))];
  const { data: events, error } = await sb.from("events").select("id,event_code").in("event_code", codes);
  if (error) throw new SeedError(`events read failed: ${error.message}`);
  const byCode = new Map<string, string[]>();
  for (const e of (events ?? []) as Array<{ id: string; event_code: string }>) {
    byCode.set(e.event_code, [...(byCode.get(e.event_code) ?? []), e.id]);
  }
  const bad = codes.filter((c) => (byCode.get(c) ?? []).length !== 1);
  if (bad.length) {
    throw new SeedError(
      `These event codes don't resolve to exactly one event; nothing is written: ${bad
        .map((c) => `${c} (${(byCode.get(c) ?? []).length})`)
        .join(", ")}`,
    );
  }
  const names = Object.keys(aliases);
  const existingBy = await loadCountAliasMap(sb);
  const { data: decided, error: nErr } = await sb
    .from("internal_count_show_names")
    .select("name,event_id,not_ours")
    .in("name", [...names, ...notOurs]);
  if (nErr) throw new SeedError(`internal_count_show_names read failed: ${nErr.message}`);
  const notOursAlready = new Set(
    ((decided ?? []) as Array<{ name: string; not_ours: boolean }>).filter((r) => r.not_ours).map((r) => r.name),
  );
  return {
    aliases: names.map((alias) => {
      const eventId = byCode.get(aliases[alias])![0];
      const have = existingBy.get(alias);
      const state = have === undefined ? "new" : have === eventId ? "already" : "conflict";
      return { alias, eventCode: aliases[alias], eventId, state, ...(state === "conflict" ? { existingEventId: have } : {}) };
    }),
    notOurs: notOurs.map((name) => ({ name, state: notOursAlready.has(name) ? "already" : "new" })),
  };
}

/**
 * Writes the plan: every decision through decideName, which writes a new
 * alias to event_count_aliases the way "Match to {event}" does. Conflicts
 * are skipped.
 */
export async function applySeed(sb: Db, ctx: RunContext, plan: SeedPlan, who: Resolver): Promise<{ aliasesWritten: number; decided: number }> {
  const fresh = plan.aliases.filter((a) => a.state === "new");
  let decided = 0;
  for (const a of plan.aliases) {
    if (a.state === "conflict") continue;
    await decideName(sb, ctx, a.alias, a.eventId, who);
    decided++;
  }
  for (const n of plan.notOurs) {
    await decideName(sb, ctx, n.name, null, who);
    decided++;
  }
  return { aliasesWritten: fresh.length, decided };
}
