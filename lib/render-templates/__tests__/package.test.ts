import assert from "node:assert/strict";
import { test } from "node:test";

import { renderPackageTool, getRenderPackageTool } from "../../mcp/tools/render.ts";
import { ToolInputError, type ToolContext } from "../../mcp/tool-types.ts";
import { MAX_PACKAGE_FILES, montageNeeds, missingList } from "../package-view.ts";
import { loadPackageState } from "../load.ts";
import { requestPackage } from "../start.ts";
import { LOOP_GUARD_MS } from "../store.ts";
import { EVENT, MATAS, NOW, TODAY, fakeStartDeps, fixtureDb } from "./fixtures.ts";

const YES = { asked: "Render the P26-BDAY montage: 9 files (no text, teaser, announcement × 9:16, 4:5, 1:1). 16 clips: 8 filmed by Puzzle, 8 Enzo Siragusa’s. Claim: 3rd release live. OK?", answer: "yes" };

function ctxFor(db: ReturnType<typeof fixtureDb>, over: Partial<ToolContext> = {}): ToolContext {
  return { db, readers: {} as never, userId: MATAS, scope: "mcp:read mcp:render", isMatas: true, render: fakeStartDeps(), seesClientNames: true, today: TODAY, now: NOW, ...over } as ToolContext;
}

async function refusal(p: Promise<unknown>): Promise<ToolInputError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ToolInputError) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

const rendered = (db: ReturnType<typeof fixtureDb>) => db.writes.filter((w) => w.table === "creative_lab_renders" || w.table === "creative_lab_render_packages");

test("the P26-BDAY picker: 16 clips (8 Puzzle’s, 8 Enzo’s), track and drop, lineup, kit, claim — all ready; another client's footage is never offered", async () => {
  const db = fixtureDb();
  const loaded = (await loadPackageState(db, EVENT, fakeStartDeps(), NOW, TODAY))!;
  assert.equal(loaded.state.event.stage, "on_sale");
  assert.ok(loaded.state.clips.every((c) => !c.id.startsWith("electric-")), "Electric Brixton's promoter footage stays with Electric Brixton");
  assert.equal(loaded.clips.all.filter((c) => !c.usable).length, 3);
  const needs = montageNeeds(loaded.state);
  assert.deepEqual(needs.map((n) => [n.label, n.state]), [["16 clips", "ready"], ["Track and drop", "ready"], ["Lineup", "ready"], ["Overlay kit", "ready"], ["Claim", "ready"]]);
  assert.equal(needs[0]!.detail, "8 filmed by Puzzle · 8 Enzo Siragusa’s");
  assert.equal(needs[2]!.detail, "6 names, from the event");
  assert.equal(needs[3]!.detail, "Puzzle’s kit");
  assert.equal(needs[4]!.detail, "3rd release live · tiers read Wed 25 Nov, 09:00");
});

test("render_package with no approval renders nothing and writes nothing (RY1)", async () => {
  const db = fixtureDb();
  const e = await refusal(renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", recipe: "montage" }));
  assert.equal(e.message, "Refused: there’s no approval with this. Ask Matas in chat, then send his exact question and answer with it. Nothing was rendered.");
  assert.equal(e.summary?.refused, "no_approval");
  assert.deepEqual(db.writes, []);
  const empty = await refusal(renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", approval: { asked: "  ", answer: "yes" } }));
  assert.equal(empty.summary?.refused, "no_approval");
  assert.deepEqual(db.writes, []);
});

test("render_package needs mcp:render and Matas, every call", async () => {
  const db = fixtureDb();
  for (const over of [{ scope: "mcp:read mcp:draft mcp:meta" }, { isMatas: false }]) {
    const e = await refusal(renderPackageTool.run(ctxFor(db, over), { event: "P26-BDAY", approval: YES }));
    assert.equal(e.summary?.refused, "insufficient_scope");
    assert.match(e.message, /Nothing was rendered\.$/);
  }
  assert.deepEqual(db.writes, []);
});

test(`over the ${MAX_PACKAGE_FILES}-file cap: refused, counted, nothing rendered`, async () => {
  const db = fixtureDb();
  const e = await refusal(renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", recipes: ["montage", "roll-call", "top-tracks", "artist-card"], approval: YES }));
  assert.equal(e.message, "Refused: this package is 33 files, over the 24-file cap for one package. Nothing was rendered.");
  assert.equal(e.summary?.line, "Refused · over the 24-file cap");
  assert.deepEqual(rendered(db), []);
});

test("another client's promoter footage in the picks: counted by client, one-form, nothing rendered (AL1)", async () => {
  const db = fixtureDb();
  const three = await refusal(renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", picks: { clips: ["electric-1", "electric-2", "https://drive.google.com/file/d/drive-electric-3/view", "enzo-1"] }, approval: YES }));
  assert.equal(three.message, "Refused: 3 of the picked clips were filmed by Electric Brixton, so they can’t go into a render for Puzzle’s show. Nothing was rendered.");
  assert.equal(three.summary?.line, "Refused · Electric Brixton’s footage in the picks");
  const one = await refusal(renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", picks: { clips: ["electric-1"] }, approval: YES }));
  assert.equal(one.message, "Refused: 1 of the picked clips was filmed by Electric Brixton, so it can’t go into a render for Puzzle’s show. Nothing was rendered.");
  assert.deepEqual(rendered(db), []);
});

test("artist-voice copy with no approved caption: refused with the two ways out", async () => {
  const db = fixtureDb();
  const e = await refusal(renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", picks: { copy: { hook: "SEE YOU IN SOUTHAMPTON", voice: "artist" } }, approval: YES }));
  assert.equal(e.message, "Refused: the copy is in Enzo Siragusa’s voice, and there’s no approved caption for it. Use an approved caption, or write it in the promoter’s voice. Nothing was rendered.");
  assert.equal(e.summary?.line, "Refused · artist-voice copy with no approved caption");
  assert.deepEqual(rendered(db), []);
});

test("design's refusal rows: not built, a bad recipe, an approval over 1,000 characters, an unknown event, no package yet", async () => {
  const db = fixtureDb();
  const notBuilt = await refusal(renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", recipe: "roll-call", approval: YES }));
  assert.equal(notBuilt.message, "Refused: Roll-call isn’t built yet. Montage (15 s) can be rendered now. Nothing was rendered.");
  const bad = await refusal(renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", recipe: "reel", approval: YES }));
  assert.equal(bad.message, "Refused: reel isn’t a recipe. The recipes are montage, roll-call, top tracks and artist card. Nothing was rendered.");
  const long = await refusal(renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", approval: { asked: "x".repeat(1001), answer: "yes" } }));
  assert.equal(long.message, "Refused: the question or the answer is over 1,000 characters. Ask Matas a shorter question, then send it and his answer word for word. Nothing was rendered.");
  const unknown = await refusal(renderPackageTool.run(ctxFor(db), { event: "NOPE-1", approval: YES }));
  assert.equal(unknown.message, "Refused: no event with code NOPE-1. Nothing was rendered.");
  const scope = await refusal(renderPackageTool.run(ctxFor(db, { isMatas: false }), { event: "P26-BDAY", approval: YES }));
  assert.equal(scope.message, "Refused: this connection can’t render. Only Matas’s can, once he reconnects Off/Pixel in Claude and allows renders. Nothing was rendered.");
  assert.equal((await getRenderPackageTool.run(ctxFor(db, { scope: "mcp:read" }), { event: "P26-BDAY" })).data, "No render package for P26-BDAY yet.");
  assert.deepEqual(rendered(db), []);
});

test("needs missing: RT3's line, ending Nothing was rendered", async () => {
  const db = fixtureDb({ puzzleClips: 0, enzoClips: 5, claim: false, track: false });
  const e = await refusal(renderPackageTool.run(ctxFor(db, { render: fakeStartDeps(false) }), { event: "P26-BDAY", approval: YES }));
  assert.equal(e.message, "Can’t render Montage (15 s) yet for P26-BDAY: clips (5 of 16 picked), track and drop, overlay kit and claim missing. Nothing was rendered.");
  assert.equal(e.summary?.line, "Refused · Montage (15 s) is missing clips (5 of 16 picked), track and drop, overlay kit and claim");
  assert.deepEqual(rendered(db), []);
});

test("on a yes: one package, nine queued files named to convention, the yes stored word for word; Claude is told m4.mcp.started", async () => {
  const db = fixtureDb();
  const out = await renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", recipe: "montage", approval: YES });
  assert.equal(out.data, "Rendering 9 files for P26-BDAY. Each is filed in Drive as it finishes.");
  const pkgs = db.writes.filter((w) => w.table === "creative_lab_render_packages" && w.op === "insert");
  assert.equal(pkgs.length, 1);
  const pkg = (pkgs[0]!.rows as Record<string, unknown>[])[0]!;
  assert.equal(pkg.source, "claude");
  assert.equal(pkg.approval_asked, YES.asked);
  assert.equal(pkg.approval_answer, "yes");
  const files = (db.writes.find((w) => w.table === "creative_lab_renders")!.rows as Record<string, unknown>[]);
  assert.equal(files.length, 9);
  assert.ok(files.every((f) => f.status === "queued" && f.recipe === "montage" && f.owner_kind === "promoter" && f.rights_shareable === false));
  assert.deepEqual(files.map((f) => f.file_name).sort(), [
    "P26-BDAY__promoter-puzzle__montage__announcement__tickets__r1__1x1.mp4",
    "P26-BDAY__promoter-puzzle__montage__announcement__tickets__r1__4x5.mp4",
    "P26-BDAY__promoter-puzzle__montage__announcement__tickets__r1__9x16.mp4",
    "P26-BDAY__promoter-puzzle__montage__no-text__no-cta__r1__1x1.mp4",
    "P26-BDAY__promoter-puzzle__montage__no-text__no-cta__r1__4x5.mp4",
    "P26-BDAY__promoter-puzzle__montage__no-text__no-cta__r1__9x16.mp4",
    "P26-BDAY__promoter-puzzle__montage__teaser__tickets__r1__1x1.mp4",
    "P26-BDAY__promoter-puzzle__montage__teaser__tickets__r1__4x5.mp4",
    "P26-BDAY__promoter-puzzle__montage__teaser__tickets__r1__9x16.mp4",
  ]);
});

test("cost guard: one package at a time per event, and none within 60 s of the last for the same recipe (server-side)", async () => {
  const db = fixtureDb();
  await renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", approval: YES });
  const busy = await refusal(renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", approval: YES }));
  assert.equal(busy.summary?.refused, "busy");
  assert.equal(busy.message, "Refused: a package for P26-BDAY is already rendering. Wait until it finishes; get_render_package shows its progress. Nothing was rendered.");
  const lab = await requestPackage(db, fakeStartDeps(), { userId: MATAS, eventId: EVENT, recipes: ["montage"], source: "lab", approval: null, now: NOW, today: TODAY });
  assert.ok(!lab.ok && "lab" in lab.refusal && lab.refusal.lab === "A package is already rendering for this show. Render again once it finishes.");
  // The first finishes; a loop tries again 30 s after it started.
  const pkgRow = (await db.from("creative_lab_render_packages").select("*")).data as Record<string, unknown>[];
  await db.from("creative_lab_render_packages").update({ status: "done", finished_at: NOW.toISOString(), created_at: new Date(NOW.getTime() - 30_000).toISOString() }).eq("id", String(pkgRow[0]!.id));
  const soon = await refusal(renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", approval: YES }));
  assert.equal(soon.summary?.refused, "too_soon");
  assert.equal(soon.message, "Refused: a Montage (15 s) package for P26-BDAY started under a minute ago. Try again in 30 seconds. Nothing was rendered.");
  const labSoon = await requestPackage(db, fakeStartDeps(), { userId: MATAS, eventId: EVENT, recipes: ["montage"], source: "lab", approval: null, now: new Date(NOW.getTime() + 29_500), today: TODAY });
  assert.ok(!labSoon.ok && "lab" in labSoon.refusal && labSoon.refusal.lab === "A Montage (15 s) package started under a minute ago. Try again in 1 second.");
  await db.from("creative_lab_render_packages").update({ created_at: new Date(NOW.getTime() - LOOP_GUARD_MS - 1).toISOString() }).eq("id", String(pkgRow[0]!.id));
  const again = await renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", approval: YES });
  assert.equal(again.summary.files, 9);
  const second = (await db.from("creative_lab_render_packages").select("round_no").order("created_at", { ascending: false })).data as Record<string, unknown>[];
  assert.equal(second[0]!.round_no, 2, "the next package is round 2");
});

test("the Lab's Render needs no approval (Matas starts it himself)", async () => {
  const db = fixtureDb({ puzzleClips: 0, enzoClips: 16 });
  const out = await requestPackage(db, fakeStartDeps(), { userId: MATAS, eventId: EVENT, recipes: ["montage"], source: "lab", approval: null, now: NOW, today: TODAY });
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.equal(out.started, "Rendering 9 files. Each appears under Renders as it finishes.");
  const files = (db.writes.find((w) => w.table === "creative_lab_renders")!.rows as Record<string, unknown>[]);
  // Artist material only: Off/Pixel's, the No text versions shareable.
  assert.ok(files.every((f) => f.owner_kind === "offpixel"));
  assert.deepEqual(files.filter((f) => f.rights_shareable).map((f) => f.variant), ["no-text", "no-text", "no-text"]);
  assert.ok(files.every((f) => String(f.file_name).startsWith("P26-BDAY__offpixel__montage__")));
});

test("get_render_package: progress while rendering; names, counts and links once done, never a Lambda or Drive error", async () => {
  const db = fixtureDb();
  await renderPackageTool.run(ctxFor(db), { event: "P26-BDAY", approval: YES });
  const ctx = ctxFor(db, { scope: "mcp:read" });
  assert.equal((await getRenderPackageTool.run(ctx, { event: "P26-BDAY" })).data, "Rendering · 0 of 9 files done");
  const rows = (await db.from("creative_lab_renders").select("*")).data as Record<string, unknown>[];
  for (const [i, r] of rows.entries()) {
    const failed = r.variant === "no-text" && r.aspect === "4:5";
    await db.from("creative_lab_renders").update({ status: "done", drive_file_id: `drive-out-${i}`, error: "Lambda says: ENOMEM at /tmp/x", drive_error: "403 from googleapis", checks: failed ? { passed: false, failed: ["format"], notes: ["1080×1080, not 1080×1350"] } : { passed: true, failed: [], notes: [] } }).eq("id", String(r.id));
  }
  await db.from("creative_lab_render_packages").update({ status: "done", finished_at: NOW.toISOString() }).eq("event_id", EVENT);
  const text = String((await getRenderPackageTool.run(ctx, { event: "P26-BDAY" })).data);
  const lines = text.split("\n");
  assert.equal(lines[0], "Done: 9 files rendered for P26-BDAY.");
  assert.equal(lines[1], "8 passed every check.");
  assert.equal(lines[2], "1 failed: Format.");
  assert.equal(lines.filter((l) => l.startsWith("- ")).length, 9);
  assert.ok(lines.includes("- P26-BDAY__promoter-puzzle__montage__no-text__no-cta__r1__4x5.mp4 · failed: Format · This client only · Puzzle · https://drive.google.com/file/d/drive-out-" + rows.findIndex((r) => r.variant === "no-text" && r.aspect === "4:5")));
  assert.equal(lines.at(-1), "8 passed and can be uploaded now. 1 failed and can’t be.");
  assert.doesNotMatch(text, /ENOMEM|googleapis|403|1080×1080|Lambda/);
});

test("missingList and montageNeeds agree with RT-A's ES27 frame (5 of 16, kit missing, no claim)", async () => {
  const db = fixtureDb({ puzzleClips: 0, enzoClips: 5, claim: false });
  const loaded = (await loadPackageState(db, EVENT, fakeStartDeps(false), NOW, TODAY))!;
  const needs = montageNeeds(loaded.state);
  assert.deepEqual(needs.map((n) => n.state), ["short", "ready", "ready", "missing", "missing"]);
  assert.equal(needs[0]!.detail, "5 Enzo Siragusa’s");
  assert.equal(missingList(needs), "clips (5 of 16 picked), overlay kit and claim");
});
