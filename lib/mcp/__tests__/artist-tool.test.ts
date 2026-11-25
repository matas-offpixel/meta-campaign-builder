/** get_artist (AL5): the record's shape and lines, and the rights. Codes and counts only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getArtistTool } from "../tools/artist.ts";
import { fakeDb } from "./fake-db.ts";
import type { ToolContext } from "../tool-types.ts";

const ELECTRIC = "c0000000-0000-4000-8000-0000000000e1";
const PUZZLE = "c0000000-0000-4000-8000-0000000000p1";
const OLD = "c0000000-0000-4000-8000-0000000000a1";
const ENZO = "a0000000-0000-4000-8000-000000000001";

const event = (id: string, code: string, client: [string, string], over: Record<string, unknown> = {}) => ({
  id,
  event_code: code,
  name: code,
  client_id: client[0],
  client: { name: client[1] },
  venue_name: null,
  venue_city: null,
  event_date: null,
  status: "on_sale",
  announcement_at: null,
  presale_at: null,
  general_sale_at: null,
  meta_campaign_id: null,
  ...over,
});

const asset = (over: Record<string, unknown>) => ({
  id: String(over.asset_key),
  artist_id: ENZO,
  kind: "clip",
  name: null,
  drive_file_id: null,
  caption_text: null,
  source_event_id: null,
  source_client_id: null,
  owner_kind: "artist",
  shareable: true,
  held_reason: null,
  approved_by: null,
  approved_at: null,
  lab_clip_id: null,
  lab_render_id: null,
  meta_ad_id: null,
  material_at: "2026-11-05T00:00:00Z",
  ...over,
});

const day = (meta_ad_id: string, campaign_name: string, spend: number, registrations: number, purchases = 0) => ({
  id: `${meta_ad_id}-d`,
  meta_ad_id,
  date: "2026-11-10",
  spend,
  registrations,
  purchases,
  campaign_name,
  campaign_objective: null,
});

function tables() {
  return {
    clients: [
      { id: ELECTRIC, name: "Electric Brixton", status: "active" },
      { id: PUZZLE, name: "Puzzle", status: "active" },
      { id: OLD, name: "Old Promoter", status: "archived" },
    ],
    events: [
      event("e-es27", "ES27-ENZOSIRAGUSA", [ELECTRIC, "Electric Brixton"], { event_date: "2027-02-19", announcement_at: "2026-11-30T17:00:00Z" }),
      event("e-bday", "P26-BDAY", [PUZZLE, "Puzzle"], {
        event_date: "2026-12-27",
        venue_name: "Circuit & Engine Rooms",
        venue_city: "Southampton",
        announcement_at: "2026-10-01T17:00:00Z",
        presale_at: "2026-10-08T09:00:00Z",
        general_sale_at: "2026-10-10T09:00:00Z",
      }),
      event("e-nx", "NX26-ENZO", [ELECTRIC, "Electric Brixton"], { event_date: "2026-10-31", venue_name: "NX Newcastle", venue_city: "Newcastle upon Tyne" }),
      event("e-old", "OLD26-X", [OLD, "Old Promoter"], { event_date: "2026-12-30" }),
    ],
    artists: [
      { id: ENZO, name: "Enzo Siragusa" },
      { id: "a-other", name: "Bullet Tooth" },
    ],
    event_artists: [
      { id: "ea1", event_id: "e-bday", artist_id: ENZO },
      { id: "ea2", event_id: "e-nx", artist_id: ENZO },
    ],
    artist_library_folders: [{ id: "f1", artist_id: ENZO, key: "artist", drive_folder_id: "FOLDER-ENZO" }],
    artist_assets: [
      // Shareable render and its ad.
      asset({ asset_key: "render:r2", kind: "render", name: "Enzo Siragusa - UGC 2", drive_file_id: "DRV-UGC2", source_event_id: "e-bday", source_client_id: PUZZLE, owner_kind: "offpixel", lab_render_id: "r2" }),
      asset({ asset_key: "ad:ad-ugc2", kind: "render", name: "ad", source_event_id: "e-bday", source_client_id: PUZZLE, owner_kind: "offpixel", lab_render_id: "r2", meta_ad_id: "ad-ugc2" }),
      // Puzzle's own: ranks best, never travels.
      asset({ asset_key: "render:r-lp", kind: "render", name: "Lineup Push - Enzo", drive_file_id: "DRV-LP", source_event_id: "e-bday", source_client_id: PUZZLE, owner_kind: "offpixel", shareable: false, held_reason: "footage", lab_render_id: "r-lp" }),
      asset({ asset_key: "ad:ad-lp", kind: "render", name: "ad", source_event_id: "e-bday", source_client_id: PUZZLE, owner_kind: "offpixel", shareable: false, held_reason: "footage", lab_render_id: "r-lp", meta_ad_id: "ad-lp" }),
      // Puzzle crowd clip, never run.
      asset({ asset_key: "clip:crowd", kind: "clip", name: "Puzzle crowd.mp4", drive_file_id: "DRV-CROWD", source_event_id: "e-bday", source_client_id: PUZZLE, owner_kind: "promoter", shareable: false, held_reason: "filmed", lab_clip_id: "crowd" }),
      // Electric's own clip.
      asset({ asset_key: "ad:ad-nx", kind: "clip", name: "Enzo Siragusa closing out NX", source_event_id: "e-nx", source_client_id: ELECTRIC, owner_kind: "promoter", shareable: false, held_reason: "filmed", meta_ad_id: "ad-nx" }),
      // A raw clip that hasn't run.
      asset({ asset_key: "drive:raw1", kind: "clip", name: "Enzo - Raw 1", drive_file_id: "DRV-RAW1" }),
      // Approved captions.
      asset({ asset_key: "caption:c1", kind: "caption", caption_text: "Back in Southampton on 27th December.", approved_by: "Enzo Siragusa’s team", approved_at: "2026-11-03T12:00:00Z", source_client_id: PUZZLE, shareable: false, held_reason: "names" }),
      asset({ asset_key: "caption:c2", kind: "caption", caption_text: "See you on the floor.", approved_by: "Enzo Siragusa’s team", approved_at: "2026-10-08T12:00:00Z", source_client_id: ELECTRIC, shareable: false, held_reason: "names" }),
      // An archived client's: never read.
      asset({ asset_key: "ad:ad-old", kind: "render", name: "Old render", drive_file_id: "DRV-OLD", source_event_id: "e-old", source_client_id: OLD, owner_kind: "offpixel", meta_ad_id: "ad-old" }),
    ],
    ad_daily_insights: [
      day("ad-ugc2", "[P26-BDAY] SIGNUP", 25.2, 12),
      day("ad-lp", "[P26-BDAY] SIGNUP", 40, 20),
      day("ad-nx", "[NX26-ENZO] SIGNUP", 26, 10),
      day("ad-old", "[OLD26-X] SIGNUP", 99, 99),
    ],
  };
}

const ctx = (): ToolContext & { db: ReturnType<typeof fakeDb> } =>
  ({ db: fakeDb(tables()), readers: {} as never, userId: "u", seesClientNames: true, today: "2026-11-25", now: new Date("2026-11-25T09:00:00Z") }) as never;

test("get_artist is read-only, with one example", () => {
  assert.equal(getArtistTool.kind, "read");
  assert.equal(getArtistTool.readOnly, undefined, "readOnlyHint follows kind read");
  assert.equal((getArtistTool.description.match(/Example: /g) ?? []).length, 1);
});

test("with an Electric event: the record's shape, shareable plus Electric's own, Puzzle's counted not listed", async () => {
  const c = ctx();
  const out = await getArtistTool.run(c, { name: "Enzo Siragusa", event: "ES27-ENZOSIRAGUSA" });
  const text = out.data as string;
  assert.equal(
    text,
    [
      "Enzo Siragusa",
      "2 shows for 2 clients, and ES27-ENZOSIRAGUSA coming up.",
      "Drive: 00 Artist Library / Enzo Siragusa · https://drive.google.com/drive/folders/FOLDER-ENZO",
      "",
      "Rights for ES27-ENZOSIRAGUSA (Electric Brixton)",
      "Listed: shareable material, and Electric Brixton’s own.",
      "Not listed: 3 more from Puzzle’s shows, which stay with Puzzle.",
      "Insight numbers can be used. Don’t name Puzzle or its shows in anything Electric Brixton sees.",
      "",
      "Shows",
      "- P26-BDAY · Puzzle · Circuit & Engine Rooms, Southampton · Sun 27 Dec 2026 · General sale · £65 on Enzo Siragusa’s ads · 32 signups",
      "- NX26-ENZO · Electric Brixton · NX Newcastle, Newcastle upon Tyne · Sat 31 Oct 2026 · Done · £26 on Enzo Siragusa’s ads · 10 signups",
      "",
      "Best for Signup",
      "1. Enzo Siragusa - UGC 2 · render · P26-BDAY · £2.10 per signup · Shareable · https://drive.google.com/file/d/DRV-UGC2",
      "2. Enzo Siragusa closing out NX · clip · NX26-ENZO · £2.60 per signup · This client only · Electric Brixton",
      "",
      "Other files",
      "- Enzo - Raw 1 · clip · Shareable · https://drive.google.com/file/d/DRV-RAW1",
      "",
      "Approved captions",
      "- “See you on the floor.” · approved by Enzo Siragusa’s team, Thu 8 Oct · This client only · Electric Brixton",
      "",
      "Insights: none yet.",
      "",
      "Newest material: Nov 2026. Look on Instagram only for what’s missing here.",
    ].join("\n"),
  );
  // Rights: no Puzzle-only file, render, clip or caption is returned for an Electric event.
  for (const s of ["Lineup Push", "DRV-LP", "Puzzle crowd", "DRV-CROWD", "Back in Southampton", "Old render", "DRV-OLD"]) assert.ok(!text.includes(s), s);
  assert.equal(out.clientId, ELECTRIC);
  assert.deepEqual(c.db.writes, [], "reads only");
});

test("a mixed render is never shareable, and Puzzle's own show sees it with its brick badge", async () => {
  const text = (await getArtistTool.run(ctx(), { name: "enzo siragusa", event: "P26-BDAY" })).data as string;
  assert.match(text, /^1\. Lineup Push - Enzo · render · P26-BDAY · £2\.00 per signup · This client only · Puzzle · https:\/\/drive\.google\.com\/file\/d\/DRV-LP$/m);
  assert.match(text, /^- Puzzle crowd\.mp4 · clip · This client only · Puzzle · /m);
  assert.match(text, /^Not listed: 2 more from Electric Brixton’s shows, which stay with Electric Brixton\.$/m);
  assert.ok(!text.includes("closing out NX"));
});

test("without an event: shareable material only", async () => {
  const text = (await getArtistTool.run(ctx(), { name: "Enzo Siragusa" })).data as string;
  assert.match(text, /^No event given, so only shareable material is listed\.$/m);
  assert.ok(text.includes("Enzo Siragusa - UGC 2"));
  assert.ok(text.includes("Enzo - Raw 1"));
  for (const s of ["Lineup Push", "closing out NX", "Puzzle crowd", "This client only", "See you on the floor"]) assert.ok(!text.includes(s), s);
  assert.ok(!/coming up/.test(text.split("\n")[1]!), "no event given, none coming up from event_artists");
});

test("no match: AL5's two lines, with the closest names", async () => {
  const out = await getArtistTool.run(ctx(), { name: "Enzo Sirgusa" });
  assert.equal(out.data, "No artist called “Enzo Sirgusa” in Off/Pixel.\nClosest: Enzo Siragusa.");
  assert.deepEqual(out.summary, { found: false, closest: 1 });
});
