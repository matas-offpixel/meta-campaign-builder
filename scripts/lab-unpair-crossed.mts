/**
 * Unpair proposed captions whose clip the angle cannot use, and retire
 * generated first-person captions. Rounds and renders are left as they
 * are. Nothing is deleted.
 *
 * Dry run by default. --apply writes.
 *
 *   npx tsx --env-file=.env.local scripts/lab-unpair-crossed.mts
 *   npx tsx --env-file=.env.local scripts/lab-unpair-crossed.mts --apply
 */

import { createClient } from "@supabase/supabase-js";

import { planUnpair, type CrossedRow, type FootageOwner } from "../lib/creative-lab/footage-owner.ts";

const apply = process.argv.includes("--apply");
const PAGE = 1000;

type Caption = {
  id: string;
  event_id: string;
  style: string;
  status: string;
  generated_by: string | null;
  mode: string | null;
  artist_id: string | null;
  clip_id: string | null;
};

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const captions: Caption[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("creative_lab_captions")
      .select("id, event_id, style, status, mode, artist_id, clip_id, generated_by")
      .eq("status", "proposed")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`creative_lab_captions: ${error.message}`);
    captions.push(...((data ?? []) as Caption[]));
    if ((data ?? []).length < PAGE) break;
  }

  const clipIds = [...new Set(captions.map((row) => row.clip_id).filter((id): id is string => Boolean(id)))];
  const clips = new Map<string, { owner: FootageOwner | null; artistId: string | null }>();
  if (clipIds.length > 0) {
    const owned = await db.from("creative_lab_clips").select("id, owner, artist_id").in("id", clipIds);
    if (owned.error && !/owner|does not exist|schema cache/i.test(owned.error.message)) throw new Error(owned.error.message);
    const rows = owned.error
      ? ((await db.from("creative_lab_clips").select("id, artist_id").in("id", clipIds)).data ?? [])
      : (owned.data ?? []);
    for (const row of rows as { id: string; owner?: string | null; artist_id: string | null }[]) {
      const owner = row.owner === "promoter" || row.owner === "artist" ? row.owner : null;
      clips.set(row.id, { owner, artistId: row.artist_id });
    }
  }

  const eventIds = [...new Set(captions.map((row) => row.event_id))];
  const names = new Map<string, string>();
  if (eventIds.length > 0) {
    const events = await db.from("events").select("id, name").in("id", eventIds);
    if (events.error) throw new Error(`events: ${events.error.message}`);
    for (const row of (events.data ?? []) as { id: string; name: string | null }[]) names.set(row.id, row.name ?? "");
  }

  const planRows: CrossedRow[] = captions.map((row) => {
    const clip = row.clip_id ? clips.get(row.clip_id) : undefined;
    return {
      id: row.id,
      eventName: names.get(row.event_id) ?? "",
      style: row.style,
      status: row.status,
      generatedBy: row.generated_by,
      mode: row.mode,
      artistId: row.artist_id,
      clipId: row.clip_id,
      clipOwner: clip?.owner ?? null,
      clipArtistId: clip?.artistId ?? null,
      featuredArtistIds: [],
    };
  });
  const plan = planUnpair(planRows);
  console.log(`puzzle lineup unpaired: ${plan.puzzleLineup}`);
  console.log(`other unpaired: ${plan.otherUnpair}`);
  console.log(`first person retired: ${plan.retireIds.length}`);
  if (!apply) {
    console.log("dry run — nothing written");
    return;
  }
  const when = new Date().toISOString();
  for (const id of plan.unpairIds) {
    const { error } = await db.from("creative_lab_captions").update({ clip_id: null, updated_at: when }).eq("id", id).eq("status", "proposed");
    if (error) throw new Error(`unpair ${id}: ${error.message}`);
  }
  for (const id of plan.retireIds) {
    const { error } = await db.from("creative_lab_captions").update({ status: "retired", clip_id: null, updated_at: when }).eq("id", id).eq("status", "proposed");
    if (error) throw new Error(`retire ${id}: ${error.message}`);
  }
  console.log("applied");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
