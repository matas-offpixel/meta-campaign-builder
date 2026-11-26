import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { lineupGenresFrom } from "../../db/event-lineup-genres.ts";
import { scoreTemplates, type ScoreAd } from "../copy/score.ts";
import { currencyResolver } from "../currency.ts";
import {
  GENRE_FAMILIES,
  GENRE_FAMILY_KEYS,
  GENRE_HELPER,
  GENRE_NOT_SET,
  GENRE_USE_IT,
  familyOfTag,
  genreFamilyForSave,
  genreFieldText,
  genreLabelInSentence,
  genreSuggestionLine,
  splitGenreTags,
  suggestGenreFamily,
  visibleSuggestion,
} from "../genre/families.ts";
import {
  GENRE_POOL_MIN_BEATS,
  beatsPercent,
  computeGenreShadow,
  copyGenreRows,
  genreRowCounts,
  genreRunDetail,
  genreStatusLines,
  genreStatusLinesFromDetail,
  loadGenreFamilies,
  poolIsOn,
  separates,
  separationRate,
  tagGenreRows,
  type GenreFamilies,
  type PairRow,
} from "../genre/shadow.ts";
import { loadGenreStatusLines } from "../genre/status.ts";
import { genreFallbackLine, genrePlanLine, genreSourceLine } from "../genre/wording.ts";
import type { LearningFact, LearningInputs } from "../joins.ts";
import { LEARNING_JOBS, learningRefreshRunLog, runLearningRefresh } from "../runner.ts";
import { capByShows } from "../shrink.ts";
import { computeTagPerformance } from "../tag-performance.ts";
import { CLIENTS, NOW, TAGS, fact } from "./fixtures.ts";

const OPERATOR = "b3ee4e5c-44e6-4684-acf6-efefbecd5858";

// ─── Migration 253 ──────────────────────────────────────────────────────────

describe("migration 253", () => {
  const sql = readFileSync("supabase/migrations/253_events_genre_family.sql", "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("adds a nullable text column with no default, and the CHECK list is exactly GK1's keys in order", () => {
    assert.match(sql, /add column if not exists genre_family text;/);
    assert.doesNotMatch(sql.slice(0, sql.indexOf("comment on column")), /not null|default/i);
    const list = [...sql.slice(sql.indexOf("genre_family in (")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(list, [...GENRE_FAMILY_KEYS]);
    assert.deepEqual(list, [
      "house_tech", "deep_afro", "melodic_prog", "disco", "garage_bass", "dnb", "techno", "hard_techno", "commercial", "no_single_genre",
    ]);
    assert.match(sql, /genre_family is null\s+or genre_family in/);
  });

  it("is additive: no backfill, no update, no drop of anything but its own constraint", () => {
    assert.doesNotMatch(sql, /\bupdate\b|\binsert\b|\bdelete\b|drop column|drop table/i);
    assert.equal([...sql.matchAll(/drop constraint/g)].length, 1);
    assert.match(sql, /drop constraint if exists events_genre_family_check/);
  });
});

// ─── GK1–GK2: the field ─────────────────────────────────────────────────────

describe("GK1: the family list and labels", () => {
  it("nine labels in order, then No single genre", () => {
    assert.deepEqual(
      GENRE_FAMILIES.map((f) => f.label),
      ["House / tech house", "Deep / afro house", "Melodic / progressive", "Disco", "Garage / bass", "Drum & bass", "Techno", "Hard techno", "Commercial / nostalgia", "No single genre"],
    );
    assert.equal(genreLabelInSentence("house_tech"), "house / tech house");
  });

  it("Not set is null, both ways; a stray value saves as null, never a guess", () => {
    assert.equal(genreFieldText(null), GENRE_NOT_SET);
    assert.equal(GENRE_NOT_SET, "Not set");
    assert.equal(genreFamilyForSave(""), null);
    assert.equal(genreFamilyForSave(undefined), null);
    assert.equal(genreFamilyForSave(null), null);
    assert.equal(genreFamilyForSave("house"), null);
    assert.equal(genreFamilyForSave("no_single_genre"), "no_single_genre");
    assert.equal(genreFamilyForSave("techno"), "techno");
  });

  it("the helper line and the action read exactly as GK2 has them", () => {
    assert.equal(GENRE_HELPER, "One per show. Shows of the same genre can share learnings once there are enough of them.");
    assert.equal(GENRE_USE_IT, "Use it");
  });
});

describe("GK2: the suggestion", () => {
  it("from the genre tags, worded as GK2", () => {
    const s = suggestGenreFamily({ tags: ["techno"] });
    assert.deepEqual(s, { key: "techno", source: "tags" });
    assert.equal(genreSuggestionLine(s!), "Suggested: Techno, from the genre tags");
  });

  it("from the lineup when no tag maps", () => {
    const s = suggestGenreFamily({ tags: ["electronic"], lineupGenres: ["uk garage", "bassline"] });
    assert.deepEqual(s, { key: "garage_bass", source: "lineup" });
    assert.equal(genreSuggestionLine(s!), "Suggested: Garage / bass, from the lineup");
  });

  it("whole-tag matches: melodic techno is melodic / progressive, hard techno is hard techno, spelling splits agree", () => {
    assert.equal(familyOfTag("melodic techno"), "melodic_prog");
    assert.equal(familyOfTag("Melodic-Techno"), "melodic_prog");
    assert.equal(familyOfTag("hard techno"), "hard_techno");
    assert.equal(familyOfTag("tech-house"), "house_tech");
    assert.equal(familyOfTag("tech house"), "house_tech");
  });

  it("most tags win; a tie goes to the earliest tag; nothing maps → no suggestion; never No single genre", () => {
    assert.equal(suggestGenreFamily({ tags: ["deep house", "techno", "afro house"] })?.key, "deep_afro");
    assert.equal(suggestGenreFamily({ tags: ["techno", "deep house"] })?.key, "techno");
    assert.equal(suggestGenreFamily({ tags: ["football", "sport"], lineupGenres: [] }), null);
    for (const tags of [["multi-genre"], ["house", "techno", "disco"]]) {
      assert.notEqual(suggestGenreFamily({ tags })?.key, "no_single_genre");
    }
  });

  it("every genre tag on prod events (16 Nov 2026) maps or is a known non-genre", () => {
    const prod = ["football", "house", "deep house", "techno", "melodic house", "melodic techno", "sport", "uk garage", "afro house", "hard techno", "disco", "electronic", "fanpark", "140", "2-step", "alternative", "bass", "bassline", "breaks", "dnb", "grime", "hip hop", "jungle", "live-sport", "melodic-techno", "minimal house", "progressive house", "rolling house", "tech house", "tech-house"];
    const unmapped = prod.filter((tag) => !familyOfTag(tag));
    assert.deepEqual(unmapped, ["football", "sport", "electronic", "fanpark", "alternative", "breaks", "hip hop", "live-sport"]);
  });

  it("shows only while the field is Not set, and is never the value", () => {
    const s = { key: "techno" as const, source: "tags" as const };
    assert.deepEqual(visibleSuggestion(null, s), s);
    assert.equal(visibleSuggestion("techno", s), null);
    assert.equal(visibleSuggestion("no_single_genre", s), null);
  });

  it("the form starts at the stored family or Not set, and splits tags as the save does", () => {
    const form = readFileSync("components/dashboard/events/event-form.tsx", "utf8");
    assert.match(form, /useState<GenreFamilyKey \| null>\(\s*genreFamilyForSave\(initial\?\.genre_family\),?\s*\)/);
    assert.doesNotMatch(form, /useState<GenreFamilyKey \| null>\([^)]*suggest/);
    assert.deepEqual(splitGenreTags(" house, ,techno "), ["house", "techno"]);
  });

  it("lineup genres: headliners first, then billing order", () => {
    assert.deepEqual(
      lineupGenresFrom([
        { is_headliner: false, billing_order: 2, artist: { genres: ["disco"] } },
        { is_headliner: true, billing_order: 5, artist: [{ genres: ["techno", " "] }] },
        { is_headliner: false, billing_order: 1, artist: null },
      ]),
      ["techno", "disco"],
    );
  });
});

// ─── "Use it" writes only that event; no bulk write ─────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|mjs|sql)$/.test(name)) out.push(full);
  }
  return out;
}

describe("no path writes genre_family without an operator", () => {
  it("the save writes the form's choice to this event only", () => {
    const form = readFileSync("components/dashboard/events/event-form.tsx", "utf8");
    assert.match(form, /genre_family: genreFamilyForSave\(genreFamily\)/);
    assert.match(form, /updateEventRow\(initial\.id, payload\)/);
    const field = readFileSync("components/dashboard/events/genre-field.tsx", "utf8");
    // "Use it" sets the form's value; it never saves on its own.
    assert.match(field, /onClick=\{\(\) => onChange\(shown\.key\)\}/);
    assert.doesNotMatch(field, /supabase|fetch\(|updateEventRow|createEventRow/);
  });

  it("only these files name genre_family, and none of them bulk-writes it", () => {
    const allowed = new Set([
      "supabase/migrations/253_events_genre_family.sql",
      // Names genre_family only in a comment on why it took 254; writes nothing.
      "supabase/migrations/254_cirqlin_page_audience_joined_reachable.sql",
      "lib/db/events.ts",
      "components/dashboard/events/event-form.tsx",
      "lib/learning/genre/families.ts",
      "lib/learning/genre/shadow.ts",
      "lib/learning/runner.ts",
      "lib/learning/__tests__/genre.test.ts",
      // M3c: the client's buildable Pages read each act's genre_family (events, select only) for Job 4's page-group seed.
      "lib/mcp/audiences/client-sources.ts",
      "lib/mcp/__tests__/audience-tools.test.ts",
      // The retargeting funnel's staged Similar tier (two-campaign record): the 08:00 read reads events.genre_family; page_groups has a genre_family column of its own.
      "lib/retargeting/runner.ts",
      "lib/retargeting/page-groups.ts",
      "lib/retargeting/__tests__/show-campaigns.test.ts",
      "lib/retargeting/__tests__/migration-275.test.ts",
      "scripts/page-groups-seed.mts",
      "supabase/migrations/275_retargeting_builds.sql",
    ]);
    // None of them writes events.
    for (const file of ["lib/retargeting/runner.ts", "lib/retargeting/page-groups.ts", "scripts/page-groups-seed.mts"]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /from\(\s*["']events["']\s*\)\s*\.(update|upsert|insert|delete)\(/, file);
    }
    const named = ["app", "components", "lib", "scripts", "supabase/migrations"].flatMap((dir) => walk(dir)).filter((file) => readFileSync(file, "utf8").includes("genre_family"));
    assert.deepEqual(named.filter((file) => !allowed.has(file)), []);
    const shadow = readFileSync("lib/learning/genre/shadow.ts", "utf8");
    assert.doesNotMatch(shadow, /\.(update|upsert|insert|delete)\(/);
    assert.doesNotMatch(readFileSync("lib/mcp/audiences/client-sources.ts", "utf8"), /\.(update|upsert|insert|delete|rpc)\(/);
  });
});

// ─── GK7 ────────────────────────────────────────────────────────────────────

describe("GK7: fewer than 3 shows never reads strong", () => {
  it("caps strong at ok below 3 shows and leaves thin and ok alone", () => {
    assert.equal(capByShows("strong", 2), "ok");
    assert.equal(capByShows("strong", 0), "ok");
    assert.equal(capByShows("strong", 3), "strong");
    assert.equal(capByShows("thin", 1), "thin");
    assert.equal(capByShows("ok", 1), "ok");
  });

  it("tag_performance: 12 funded ads and £720 on 2 shows read ok, at every scope", () => {
    const facts = ["e1", "e2"].flatMap((eventId) =>
      Array.from({ length: 6 }, (_, i) =>
        fact({ meta_ad_id: `${eventId}-${i}`, date: "2026-10-01", spend: 60, registrations: 20 }, { clientId: "client-a", eventId, tagIds: ["t-motion"] }),
      ),
    );
    const rows = computeTagPerformance(facts, CLIENTS, TAGS, { now: NOW, shows: new Map([["e1", "s1"], ["e2", "s2"]]) });
    assert.ok(rows.length >= 3);
    for (const row of rows) {
      assert.equal(row.events_n, 2);
      assert.equal(row.confidence, "ok", `${row.scope}`);
    }
    // The same evidence on 3 shows is strong.
    const three = computeTagPerformance(
      facts.map((f, i) => ({ ...f, eventId: ["e1", "e2", "e3"][i % 3] })),
      CLIENTS,
      TAGS,
      { now: NOW, shows: new Map([["e1", "s1"], ["e2", "s2"], ["e3", "s3"]]) },
    );
    assert.ok(three.every((row) => row.confidence === "strong"));
  });

  it("copy rows: 3 shows never read strong (strong needs 4)", () => {
    const ads: ScoreAd[] = ["e1", "e2", "e3"].flatMap((eventId) =>
      [0, 1].map((i) => ({
        metaAdId: `${eventId}-${i}`, eventId, showId: eventId, pageId: null, clientId: "client-a", vertical: "music",
        stage: "ticket_sale" as const, voice: "promoter" as const, spend: 400, results: 40,
        lines: [{ field: "body" as const, key: "tickets on sale now dont miss out", text: "Tickets on sale now. Don't miss out." }],
      })),
    );
    const rows = scoreTemplates(ads);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.events_n === 3 && row.confidence !== "strong"));
  });
});

// ─── The shadow computation ─────────────────────────────────────────────────

/**
 * Six house / tech house shows over two clients, three techno shows on one.
 * House: motion ads cheap, still dear. Techno: the reverse. So the techno
 * rows sit across 1 from the all rows and the house rows don't.
 */
const HOUSE = ["h1", "h2", "h3", "h4", "h5", "h6"];
const TECHNO = ["t1", "t2", "t3"];
const SHOWS = new Map([...HOUSE, ...TECHNO].map((id) => [id, `show-${id}`]));
const FAMILIES = new Map<string, "house_tech" | "techno">([...HOUSE.map((id) => [id, "house_tech"] as const), ...TECHNO.map((id) => [id, "techno"] as const)]);

function shadowFacts(): LearningFact[] {
  const out: LearningFact[] = [];
  for (const eventId of [...HOUSE, ...TECHNO]) {
    const house = eventId.startsWith("h");
    const clientId = house && Number(eventId.slice(1)) % 2 === 0 ? "client-b" : "client-a";
    for (const [tag, cheap] of [["t-motion", house], ["t-still", !house]] as const) {
      for (const i of [1, 2]) {
        out.push(fact({ meta_ad_id: `${eventId}-${tag}-${i}`, date: "2026-10-01", spend: 60, registrations: cheap ? 12 : 3 }, { clientId, eventId, tagIds: [tag] }));
      }
    }
  }
  return out;
}

function families(map: ReadonlyMap<string, "house_tech" | "techno"> = FAMILIES): GenreFamilies {
  return { read: true, byEvent: new Map(map) };
}

describe("shadow genre rows: tag_performance", () => {
  const facts = shadowFacts();
  const tagRows = computeTagPerformance(facts, CLIENTS, TAGS, { now: NOW, shows: SHOWS });

  it("genre rows carry the genre as scope_id with the genre's own baseline", () => {
    const rows = tagGenreRows(facts, FAMILIES, TAGS, { now: NOW, shows: SHOWS });
    const techno = rows.find((r) => r.scope_id === "techno" && r.value_key === "motion")!;
    assert.equal(techno.scope, "client");
    assert.equal(techno.events_n, 3);
    assert.equal(techno.index, 2.5);
    const house = rows.find((r) => r.scope_id === "house_tech" && r.value_key === "motion")!;
    assert.equal(house.index, 0.625);
    assert.equal(house.events_n, 6);
    const all = tagRows.find((r) => r.scope === "all" && r.value_key === "motion")!;
    assert.equal(all.index, 0.8333);
  });

  it("the real grouping: 4 pairs, the 2 techno rows separate", () => {
    const result = computeGenreShadow({ families: families(), facts, tags: TAGS, shows: SHOWS, tagRows, library: null, copyRows: [], now: NOW, shuffles: 30 });
    const tags = result.jobs.find((j) => j.job === "tag_performance")!;
    assert.equal(tags.pairs, 4);
    assert.equal(tags.separating, 2);
    assert.equal(tags.shuffles, 30);
    assert.ok(tags.beats != null && tags.beats >= 0 && tags.beats <= 1);
    assert.deepEqual(tags.families, [
      { family: "house_tech", shows: 6, clients: 2 },
      { family: "techno", shows: 3, clients: 1 },
    ]);
    // Techno has 1 client and 3 shows: never on, whatever the shuffles say.
    assert.ok(!tags.on.includes("techno"));
    // Deterministic: the same night twice gives the same answer.
    const again = computeGenreShadow({ families: families(), facts, tags: TAGS, shows: SHOWS, tagRows, library: null, copyRows: [], now: NOW, shuffles: 30 });
    assert.deepEqual(again.jobs, result.jobs);
  });

  it("GK7 at genre scope: with only 2 techno shows, the techno rows don't count", () => {
    const two = new Map([...FAMILIES].filter(([id]) => id !== "t3"));
    const result = computeGenreShadow({ families: families(two), facts, tags: TAGS, shows: SHOWS, tagRows, library: null, copyRows: [], now: NOW, shuffles: 5 });
    const tags = result.jobs.find((j) => j.job === "tag_performance")!;
    assert.equal(tags.pairs, 2);
    assert.equal(tags.separating, 0);
  });

  it("one family, or no families: not tested, no shuffles", () => {
    const one = computeGenreShadow({ families: families(new Map(HOUSE.map((id) => [id, "house_tech"]))), facts, tags: TAGS, shows: SHOWS, tagRows, library: null, copyRows: [], now: NOW });
    assert.equal(one.jobs[0].beats, null);
    assert.equal(one.jobs[0].shuffles, 0);
    const none = computeGenreShadow({ families: families(new Map()), facts, tags: TAGS, shows: SHOWS, tagRows, library: null, copyRows: [], now: NOW });
    assert.deepEqual(none.jobs.map((j) => [j.job, j.families.length, j.beats]), [
      ["tag_performance", 0, null],
      ["copy_performance", 0, null],
      ["copy_features", 0, null],
    ]);
  });

  it("the shuffles stop at the time budget and score what ran", () => {
    let t = 0;
    const result = computeGenreShadow({
      families: families(), facts, tags: TAGS, shows: SHOWS, tagRows, library: null, copyRows: [], now: NOW, shuffles: 100, budgetMs: 10,
      clock: () => (t += 6),
    });
    assert.ok(result.jobs[0].shuffles >= 1 && result.jobs[0].shuffles < 100);
  });
});

describe("shadow genre rows: copy", () => {
  it("genre rows are vertical-scope only, keyed by family, against the whole library's baselines", () => {
    const line = { field: "body" as const, key: "tickets on sale now dont miss out", text: "Tickets on sale now. Don't miss out." };
    const base = (eventId: string, spend: number, results: number): ScoreAd => ({
      metaAdId: `${eventId}-a`, eventId, showId: eventId, pageId: null, clientId: "client-a", vertical: "music", stage: "ticket_sale", voice: "promoter", spend, results, lines: [line],
    });
    const other = (eventId: string): ScoreAd => ({ ...base(eventId, 900, 10), metaAdId: `${eventId}-b`, lines: [{ field: "body", key: "something else entirely here now", text: "x" }] });
    const ads = [base("h1", 100, 10), other("h1"), base("h2", 100, 10), other("h2"), base("x1", 100, 10)];
    const rows = copyGenreRows(ads.filter((a) => a.eventId !== "x1"), ads, new Map([["h1", "house_tech"], ["h2", "house_tech"]]));
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.scope === "vertical" && r.scope_id === "house_tech"));
    // Event baseline from the whole library (1000 / 20 = 50): expected 2 per ad, actual 10.
    const hit = rows.find((r) => r.template_key === line.key)!;
    assert.equal(hit.events_n, 2);
    assert.ok(hit.index_vs_event! < 1);
  });
});

describe("the control's pieces", () => {
  const row = (key: string, index: number | null, eventsN = 3, confidence: PairRow["confidence"] = "ok"): PairRow => ({ key, index, confidence, eventsN });

  it("separates: opposite sides of 1, or 0.3 apart across 1", () => {
    assert.ok(separates(0.8, 1.2));
    assert.ok(separates(1.2, 0.8));
    assert.ok(separates(0.7, 1.0));
    assert.ok(!separates(0.85, 1.05));
    assert.ok(!separates(0.6, 0.8));
  });

  it("genre rows need 3 shows, an index and not thin; all rows need an index and not thin", () => {
    assert.ok(genreRowCounts(row("a", 0.5)));
    assert.ok(!genreRowCounts(row("a", 0.5, 2)));
    assert.ok(!genreRowCounts(row("a", null)));
    assert.ok(!genreRowCounts(row("a", 0.5, 9, "thin")));
    const all = new Map([["a", row("a", 1.3)], ["b", row("b", 1.3, 9, "thin")]]);
    assert.deepEqual(separationRate([row("a", 0.5), row("b", 0.5), row("c", 0.5)], all), { pairs: 1, separating: 1, rate: 1 });
  });

  it("a pool is on at 5 shows across 2 clients and beating 90 % of shuffles", () => {
    assert.equal(GENRE_POOL_MIN_BEATS, 0.9);
    assert.ok(poolIsOn({ family: "house_tech", shows: 5, clients: 2 }, 0.9));
    assert.ok(!poolIsOn({ family: "house_tech", shows: 4, clients: 2 }, 1));
    assert.ok(!poolIsOn({ family: "garage_bass", shows: 6, clients: 1 }, 1));
    assert.ok(!poolIsOn({ family: "house_tech", shows: 9, clients: 3 }, 0.89));
    assert.ok(!poolIsOn({ family: "house_tech", shows: 9, clients: 3 }, null));
  });
});

// ─── GK3: the status line ───────────────────────────────────────────────────

describe("GK3: the operator status line", () => {
  it("off: frame G4's line exactly", () => {
    assert.deepEqual(genreStatusLines({ job: "copy_features", families: [{ family: "house_tech", shows: 9, clients: 3 }], beats: 0.63, on: [] }), [
      "Genre pool off · copy_features: 9 house / tech house shows across 3 clients. Needs 5 shows across 2 clients, and to beat 90 % of shuffles. Today: 63 %.",
    ]);
  });

  it("on: GK3's line, one per family that is on", () => {
    assert.deepEqual(
      genreStatusLines({ job: "tag_performance", families: [{ family: "house_tech", shows: 12, clients: 4 }, { family: "garage_bass", shows: 6, clients: 1 }], beats: 0.92, on: ["house_tech"] }),
      ["Genre pool on · tag_performance · House / tech house: 12 shows across 4 clients, beats 92 % of shuffles."],
    );
  });

  it("the percent rounds down, so just under the bar never reads as at it", () => {
    assert.equal(beatsPercent(0.899), 89);
    assert.equal(beatsPercent(0.9), 90);
    assert.equal(beatsPercent(0.63), 63);
  });

  it("new strings: no genre yet, not tested, not read; one show / one client", () => {
    assert.deepEqual(genreStatusLines({ job: "tag_performance", families: [], beats: null, on: [] }), [
      "Genre pool off · tag_performance: no shows have a genre yet. Needs 5 shows across 2 clients, and to beat 90 % of shuffles.",
    ]);
    assert.deepEqual(genreStatusLines({ job: "copy_performance", families: [{ family: "techno", shows: 1, clients: 1 }], beats: null, on: [] }), [
      "Genre pool off · copy_performance: 1 techno show across 1 client. Needs 5 shows across 2 clients, and to beat 90 % of shuffles. Today: not tested.",
    ]);
    assert.deepEqual(genreStatusLines({ job: "copy_features", families: [], beats: null, on: [] }, false), [
      "Genre pool off · copy_features: genres couldn't be read this run.",
    ]);
  });

  it("round-trips through the run log detail; junk reads as nothing", () => {
    const result = computeGenreShadow({ families: families(), facts: shadowFacts(), tags: TAGS, shows: SHOWS, tagRows: [], library: null, copyRows: [], now: NOW, shuffles: 3 });
    const detail = genreRunDetail(result);
    const log = learningRefreshRunLog({ ok: true, jobs: { tag_performance: { ok: true, rows: 1 } }, genre: detail });
    assert.deepEqual(log.detail.genre, detail);
    const lines = genreStatusLinesFromDetail(log.detail);
    assert.equal(lines.length, 3);
    assert.ok(lines.every((l) => l.startsWith("Genre pool off · ")));
    assert.deepEqual(genreStatusLinesFromDetail(null), []);
    assert.deepEqual(genreStatusLinesFromDetail({ genre: { jobs: [{ job: "funnel" }] } }), []);
    assert.deepEqual(learningRefreshRunLog({ ok: true, jobs: {} }).detail, { jobs: {} });
  });

  it("operator-only: anyone else gets null and no read is made", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    assert.equal(await loadGenreStatusLines(db, "4b8c0000-0000-0000-0000-000000000000"), null);
    assert.equal(await loadGenreStatusLines(db, null), null);
    assert.equal(calls.length, 0);
    let built = false;
    assert.equal(await loadGenreStatusLines(() => ((built = true), db), "someone-else"), null);
    assert.equal(built, false);
  });

  it("an operator reads the latest learning-refresh run's lines", async () => {
    const detail = { genre: { read: true, events: 0, jobs: [{ job: "copy_features", families: [{ family: "house_tech", shows: 9, clients: 3 }], pairs: 4, separating: 1, shuffles: 100, beats: 0.63, on: [] }] } };
    const { db, calls } = fakeDb(() => ({ data: [{ detail, started_at: "2026-11-16T03:30:00Z" }], error: null }));
    assert.deepEqual(await loadGenreStatusLines(db, OPERATOR), [
      "Genre pool off · copy_features: 9 house / tech house shows across 3 clients. Needs 5 shows across 2 clients, and to beat 90 % of shuffles. Today: 63 %.",
    ]);
    assert.equal(calls[0].table, "cron_runs");
    assert.deepEqual(op(calls[0], "eq"), ["cron_name", "learning-refresh"]);
  });

  it("the page asks the loader with the session user, and renders nothing for null", () => {
    const page = readFileSync("app/(dashboard)/admin/cron-health/page.tsx", "utf8");
    assert.match(page, /loadGenreStatusLines\(\(\) => createServiceRoleClient\(\), user\.id\)/);
    assert.match(page, /\{genreLines \? <GenrePoolStatus lines=\{genreLines\} \/> : null\}/);
  });
});

// ─── GK3: no reader returns a genre row ─────────────────────────────────────

describe("GK3: shadow is silent", () => {
  it("only the runner imports the shadow module (the report and frames take the status lines alone)", () => {
    const importers = ["app", "components", "lib", "scripts"]
      .flatMap((dir) => walk(dir))
      .filter((file) => /from "[^"]*genre\/shadow(\.ts)?"|from "\.\/shadow\.ts"/.test(readFileSync(file, "utf8")));
    assert.deepEqual(importers.filter((f) => !f.includes("__tests__")).sort(), ["lib/learning/runner.ts"]);
  });

  it("every learning reader reads the stored tables only, which hold no genre scope", () => {
    for (const reader of ["lib/learning/read.ts", "lib/creative-lab/voice-shape.ts", "lib/plan/benchmarks.ts"]) {
      const source = readFileSync(reader, "utf8");
      assert.doesNotMatch(source, /genre/i, reader);
    }
    for (const dir of ["lib/learning/cross-client", "lib/insights-rail", "lib/onsale-refresh"]) {
      for (const file of walk(dir).filter((f) => !f.includes("__tests__"))) assert.doesNotMatch(readFileSync(file, "utf8"), /genre\/(shadow|wording)|genre_family/, file);
    }
  });

  it("the runner writes the job's own rows only: the genre job writes nothing, live or dry", async () => {
    const inputs: LearningInputs = {
      clients: CLIENTS,
      shows: SHOWS,
      archivedClientIds: new Set(),
      facts: shadowFacts(),
      dropped: { noClient: 0, archived: 0 },
      adSets: [],
      tags: TAGS,
      currency: currencyResolver(new Map()),
    };
    const { db, calls } = fakeDb((call) => (call.table === "interest_clusters" ? { data: [], error: null } : call.table === "creative_scores" ? { data: { id: "x" }, error: null } : { data: [], error: null }));
    const result = await runLearningRefresh({ env: { ENABLE_LEARNING_REFRESH: "1" }, db, now: NOW, operatorUserId: "op", inputs, confirm: null, genreFamilies: families(), genreShuffles: 5 });
    if ("skippedReason" in result) throw new Error("killswitch");
    assert.deepEqual(Object.keys(result.jobs), [...LEARNING_JOBS, "genre_shadow"]);
    assert.equal(result.jobs.genre_shadow!.ok, true);
    assert.equal(result.jobs.genre_shadow!.rows, 0);
    assert.equal(result.genre?.jobs.length, 3);
    const tagUpserts = calls.filter((c) => c.table === "tag_performance" && op(c, "upsert")).flatMap((c) => op(c, "upsert")![0] as { scope: string; scope_id: string }[]);
    assert.ok(tagUpserts.length > 0);
    assert.ok(tagUpserts.every((r) => ["client", "vertical", "all"].includes(r.scope) && !["house_tech", "techno"].includes(r.scope_id)));
    assert.ok(
      calls.every((c) => c.table !== "events" || !["update", "upsert", "insert", "delete"].some((name) => op(c, name))),
      "nothing writes events",
    );
  });

  it("archived clients stay out: their events' families are not read into the pool", async () => {
    const { db } = fakeDb(() => ({
      data: [
        { id: "e1", client_id: "client-a", genre_family: "techno" },
        { id: "e2", client_id: "client-archived", genre_family: "techno" },
        { id: "e3", client_id: "client-a", genre_family: "no_single_genre" },
      ],
      error: null,
    }));
    const loaded = await loadGenreFamilies(db, new Set(["client-archived"]));
    assert.equal(loaded.read, true);
    assert.deepEqual([...loaded.byEvent], [["e1", "techno"]]);
    const broken = fakeDb(() => ({ data: null, error: { message: 'column events.genre_family does not exist' } }));
    const unread = await loadGenreFamilies(broken.db, new Set());
    assert.equal(unread.read, false);
    assert.equal(unread.byEvent.size, 0);
  });
});

// ─── GK4 wording ────────────────────────────────────────────────────────────

describe("GK4: genre-sourced wording", () => {
  it("counts only, lower-case label inside the sentence", () => {
    assert.equal(genreSourceLine(9, "house_tech", 3), "From 9 house / tech house shows across 3 clients");
    assert.equal(genreFallbackLine("Puzzle", 9, "house_tech", 3), "Not enough of Puzzle's own shows yet, so this is from 9 house / tech house shows across 3 clients.");
    assert.equal(genrePlanLine(6, "melodic_prog", 2), "Compared with 6 melodic / progressive shows across 2 clients");
  });

  it("names no other client: the only name in a line is the one passed in", () => {
    const others = ["Electric Brixton", "IRONWORKS", "Deep House Bible", "Louder / Parable", "Throwback", "GMC Worldwide Productions", "Innellea"];
    const lines = [genreSourceLine(9, "house_tech", 3), genreFallbackLine("Puzzle", 9, "house_tech", 3), genrePlanLine(6, "melodic_prog", 2)];
    for (const line of lines) for (const name of others) assert.ok(!line.includes(name), `${name} in ${line}`);
  });
});

// ─── Who can see it ─────────────────────────────────────────────────────────

describe("internal only", () => {
  it("no client /admin, share or landing surface mounts the Genre field or a genre line", () => {
    const surfaces = ["app/admin", "app/share", "app/l", "app/c", "app/j", "components/admin-dashboard", "components/share"].filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
    assert.ok(surfaces.includes("app/admin") && surfaces.includes("app/share"));
    for (const file of surfaces.flatMap((dir) => walk(dir))) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /genre-field|genre-pool-status|genre-sourced-line|learning\/genre\/|genre_family/, file);
    }
  });

  it("the event form is mounted only on the operator event routes", () => {
    const mounts = walk("app").filter((file) => /from "@\/components\/dashboard\/events\/event-form"/.test(readFileSync(file, "utf8")));
    assert.deepEqual(mounts.sort(), ["app/(dashboard)/events/[id]/edit/page.tsx", "app/(dashboard)/events/new/page.tsx"]);
  });
});
