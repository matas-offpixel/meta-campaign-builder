import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  levenshtein,
  mergeArtistCandidate,
  normaliseName,
  pickBestMusicBrainzMatch,
} from "../artist-merger.ts";
import type { SpotifyArtist } from "../spotify.ts";
import type { MusicBrainzCandidate, MusicBrainzUrls } from "../musicbrainz.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture<T>(name: string): T {
  const raw = readFileSync(join(__dirname, "fixtures", name), "utf8");
  return JSON.parse(raw) as T;
}

test("normaliseName strips punctuation, whitespace, accents", () => {
  assert.equal(normaliseName("DJ Tennis (Live)"), "djtennislive");
  assert.equal(normaliseName("Sub Focus"), normaliseName("sub-focus"));
  assert.equal(normaliseName("Béyoncé"), "beyonce");
  assert.equal(normaliseName("  Fred  again..  "), "fredagain");
});

test("levenshtein scores common typos correctly", () => {
  assert.equal(levenshtein("kitten", "kitten"), 0);
  assert.equal(levenshtein("kitten", "sitten"), 1);
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("abc", ""), 3);
});

test("pickBestMusicBrainzMatch prefers closest name within threshold", () => {
  const candidates: MusicBrainzCandidate[] = [
    {
      id: "mb-1",
      name: "Fred again..",
      score: 100,
      country: "GB",
      disambiguation: null,
    },
    {
      id: "mb-2",
      name: "Fred Astaire",
      score: 80,
      country: "US",
      disambiguation: null,
    },
  ];
  const best = pickBestMusicBrainzMatch("Fred again..", candidates);
  assert.ok(best);
  assert.equal(best?.id, "mb-1");
});

test("pickBestMusicBrainzMatch returns null when distance > 3", () => {
  const candidates: MusicBrainzCandidate[] = [
    { id: "x", name: "Totally Different Artist", score: 30, country: null, disambiguation: null },
  ];
  assert.equal(pickBestMusicBrainzMatch("Fred again..", candidates), null);
});

test("pickBestMusicBrainzMatch tolerates punctuation differences", () => {
  const candidates: MusicBrainzCandidate[] = [
    { id: "mb", name: "Sub-Focus", score: 95, country: "GB", disambiguation: null },
  ];
  const best = pickBestMusicBrainzMatch("Sub Focus", candidates);
  assert.equal(best?.id, "mb");
});

test("mergeArtistCandidate blends Spotify + MusicBrainz fields", () => {
  const spotify = loadFixture<SpotifyArtist>("spotify-fred-again.json");
  const mb = loadFixture<{ artist: MusicBrainzCandidate; urls: MusicBrainzUrls }>(
    "musicbrainz-fred-again.json",
  );
  const merged = mergeArtistCandidate(spotify, mb);
  assert.equal(merged.name, "Fred again..");
  assert.equal(merged.spotify_id, spotify.id);
  assert.equal(merged.musicbrainz_id, mb.artist.id);
  assert.deepEqual(merged.genres, spotify.genres);
  assert.equal(merged.popularity_score, 78);
  assert.equal(merged.profile_image_url, spotify.image_url);
  assert.equal(merged.instagram_handle, "@fredagainagainagain");
  assert.equal(merged.facebook_page_url, "https://www.facebook.com/fredagainmusic");
  assert.equal(merged.tiktok_handle, "@fredagainmusic");
  assert.equal(merged.soundcloud_url, "https://soundcloud.com/fredagain");
  assert.equal(merged.beatport_url, "https://www.beatport.com/artist/fred-again/930512");
  assert.equal(merged.website, "https://fredagain.com");
  assert.equal(merged.bandcamp_url, null);
  // Raw blob preserved for debug + future fields
  assert.ok(merged.profile_jsonb.spotify);
  assert.ok(merged.profile_jsonb.musicbrainz);
});

test("mergeArtistCandidate falls back to Spotify-only when MB is null", () => {
  const spotify = loadFixture<SpotifyArtist>("spotify-fred-again.json");
  const merged = mergeArtistCandidate(spotify, null);
  assert.equal(merged.spotify_id, spotify.id);
  assert.equal(merged.musicbrainz_id, null);
  assert.equal(merged.instagram_handle, null);
  assert.equal(merged.facebook_page_url, null);
  assert.equal(merged.beatport_url, null);
  assert.deepEqual(merged.genres, spotify.genres);
  assert.equal(merged.popularity_score, 78);
  assert.equal(
    (merged.profile_jsonb as { musicbrainz: unknown }).musicbrainz,
    null,
  );
});
