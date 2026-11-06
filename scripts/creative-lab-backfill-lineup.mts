/**
 * Link Puzzle 4th Birthday's lineup to library artists.
 *
 * Dry-run by default. `--apply` writes artists, event_artists and the
 * Lab artist links. Claude runs `--apply` after migration 205 is applied.
 * Nothing here touches the cancelled Part 1 or Part 2 events.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { P26_BDAY_LINEUP, planLineupBackfill, saveLabLineup } from "../lib/creative-lab/lineup.ts";

const EVENT_ID = "a092aca8-7d9d-4ccd-9eb8-1ada0a62d3d8";
const APPLY = process.argv.includes("--apply");

function envValue(name: string): string {
  if (process.env[name]) return process.env[name] ?? "";
  const file = readFileSync(resolve(".env.local"), "utf8");
  const line = file.split("\n").find((row) => row.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).replace(/^"|"$/g, "") : "";
}

function text(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? "").trim();
}

async function main() {
  const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase URL or service role key is missing.");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const event = await db.from("events").select("id, user_id, event_code, name").eq("id", EVENT_ID).maybeSingle();
  if (event.error) throw new Error(event.error.message);
  if (!event.data || event.data.event_code !== "P26-BDAY") throw new Error("Puzzle 4th Birthday was not found.");
  const userId = event.data.user_id;
  const [artists, labArtists] = await Promise.all([
    db.from("artists").select("id, name").eq("user_id", userId),
    db.from("creative_lab_artists").select("id, name, client_id").eq("user_id", userId),
  ]);
  if (artists.error) throw new Error(artists.error.message);
  if (labArtists.error) throw new Error(labArtists.error.message);
  const plan = planLineupBackfill({
    eventId: EVENT_ID,
    names: P26_BDAY_LINEUP,
    artists: (artists.data ?? []).map((row) => ({ id: text(row, "id"), name: text(row, "name") })),
    labArtists: (labArtists.data ?? []).map((row) => ({ id: text(row, "id"), name: text(row, "name") })),
  });
  console.log(JSON.stringify({ apply: APPLY, event: event.data.name, eventCode: event.data.event_code, plan }, null, 2));
  if (!APPLY) return;

  const ids = new Map<string, string>();
  for (const row of plan.rows) {
    if (row.artistId) {
      ids.set(row.name, row.artistId);
      continue;
    }
    const inserted = await db.from("artists").insert({ user_id: userId, name: row.name }).select("id").single();
    if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "Could not create the artist.");
    ids.set(row.name, inserted.data.id);
  }
  await saveLabLineup(db, {
    userId,
    eventId: EVENT_ID,
    slots: plan.rows.map((row) => ({ artistId: ids.get(row.name) ?? "", isHeadliner: row.isHeadliner })),
  });
  for (const link of plan.links) {
    const artistId = ids.get(link.name);
    if (!artistId) continue;
    const updated = await db.from("creative_lab_artists").update({ artist_id: artistId }).eq("id", link.labArtistId);
    if (updated.error) throw new Error(updated.error.message);
  }
  console.log("applied");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Backfill failed.";
  console.error(message.replace(/https?:\/\/\S+/g, "[url]"));
  process.exitCode = 1;
});
