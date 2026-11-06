/**
 * Fill artist photos from an exact Spotify name.
 * Dry-run by default. `--apply` writes. Claude applies; this branch does not.
 *
 *   npx tsx scripts/creative-lab-spotify-enrich.mts
 *   npx tsx scripts/creative-lab-spotify-enrich.mts --apply
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

import { enrichLibraryArtists, P26_BDAY_LINEUP } from "../lib/creative-lab/lineup.ts";
import { spotifyNameMatch } from "../lib/creative-lab/spotify-match.ts";

type SpotifyNameHit = { id: string; name: string; image_url: string | null; genres: string[] };

const EVENT_ID = "a092aca8-7d9d-4ccd-9eb8-1ada0a62d3d8";
const APPLY = process.argv.includes("--apply");

function envValue(name: string): string {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  const line = readFileSync(".env.local", "utf8").split("\n").find((row) => row.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).trim().replace(/^"|"$/g, "") ?? "";
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function token(): Promise<string> {
  const basic = Buffer.from(`${envValue("SPOTIFY_CLIENT_ID")}:${envValue("SPOTIFY_CLIENT_SECRET")}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`Spotify token HTTP ${res.status}`);
  const body = await res.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Spotify token missing");
  return body.access_token;
}

async function search(access: string, name: string): Promise<SpotifyNameHit[]> {
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("type", "artist");
  url.searchParams.set("q", name);
  url.searchParams.set("limit", "5");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) throw new Error(`Spotify search HTTP ${res.status}`);
  const body = await res.json() as { artists?: { items?: Array<{ id?: string; name?: string; genres?: string[]; images?: Array<{ url?: string }> }> } };
  return (body.artists?.items ?? []).flatMap((row) => {
    const id = row.id?.trim();
    const found = row.name?.trim();
    if (!id || !found) return [];
    return [{ id, name: found, image_url: row.images?.[0]?.url ?? null, genres: row.genres ?? [] }];
  });
}

async function main(): Promise<void> {
  const db = createClient(envValue("NEXT_PUBLIC_SUPABASE_URL"), envValue("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const event = await db.from("events").select("name, event_code, user_id").eq("id", EVENT_ID).single();
  if (event.error || !event.data) throw new Error(event.error?.message || "Event not found");
  const links = await db.from("event_artists").select("artist_id").eq("event_id", EVENT_ID);
  if (links.error) throw new Error(links.error.message);
  const ids = (links.data ?? []).map((row) => String(row.artist_id)).filter(Boolean);
  const artists = ids.length
    ? await db.from("artists").select("id, name, spotify_id").in("id", ids)
    : { data: [], error: null };
  if (artists.error) throw new Error(artists.error.message);
  const wanted = new Set(P26_BDAY_LINEUP.map((row) => row.name.toLowerCase()));
  const rows = (artists.data ?? [])
    .map((row) => ({ id: String(row.id), name: String(row.name ?? "").trim(), spotify_id: row.spotify_id ? String(row.spotify_id) : null }))
    .filter((row) => wanted.has(row.name.toLowerCase()));

  const access = await token();
  const found: Array<{ name: string; already: boolean; kind: string; matches: string[] }> = [];
  const hits = new Map<string, SpotifyNameHit[]>();
  for (const row of rows) {
    const matches = row.spotify_id ? [] : await search(access, row.name);
    hits.set(row.id, matches);
    found.push({
      name: row.name,
      already: Boolean(row.spotify_id),
      kind: row.spotify_id ? "already" : spotifyNameMatch(row.name, matches).kind,
      matches: matches.map((hit) => hit.name),
    });
  }
  console.log(JSON.stringify({ apply: APPLY, event: event.data.name, eventCode: event.data.event_code, artists: found }, null, 2));
  if (!APPLY) return;
  const result = await enrichLibraryArtists(db, {
    userId: String(event.data.user_id ?? ""),
    artistIds: rows.map((row) => row.id),
    search: async (name) => {
      const row = rows.find((item) => item.name === name);
      return row ? hits.get(row.id) ?? [] : [];
    },
  });
  console.log(JSON.stringify(result));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Spotify enrich failed.";
  console.error(message.replace(/https?:\/\/\S+/g, "[url]"));
  process.exitCode = 1;
});
