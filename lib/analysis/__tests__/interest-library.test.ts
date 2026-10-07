import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import XLSX from "xlsx";

import { embeddedSeedJson } from "../cluster-seed-sql.ts";
import {
  buildLibrary,
  parseLibrarySheet,
  parseLibraryWorkbook,
  resolveInterestName,
  splitLibraryCell,
  type LibraryChatCluster,
  type LibrarySeedRow,
  type ParsedLibrary,
  type Resolution,
} from "../interest-library.ts";
import type { InterestReportJson } from "../interest-performance.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const REPORT: InterestReportJson = JSON.parse(read("docs/analysis/interest-performance-2026-10-06.json"));

function workbookSheets() {
  const wb = XLSX.read(readFileSync(join(ROOT, "docs/analysis/meta-interest-targets-library.xlsx")));
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, defval: "", raw: false }),
  }));
}

function columnMap(parsed: ParsedLibrary, tab: string): Record<string, string[]> {
  return Object.fromEntries(parsed.columns.filter((c) => c.tab === tab).map((c) => [c.column, c.names]));
}

const resolveFrom = (table: Record<string, string>) => (name: string): Resolution | null =>
  table[name] ? { id: table[name], name, match: "exact" } : null;

describe("interest library import", () => {
  it("parses the original Labels tab and the other Updated tabs, column header → names", () => {
    const parsed = parseLibraryWorkbook(workbookSheets());
    assert.deepEqual(columnMap(parsed, "Labels"), {
      "Tech House": ["Crosstown Rebels", "Hot creations", "Toolroom", "Defected Records", "Suara"],
      Melodic: [
        "Anjuna", "Anjunabeats", "Anjunadeep", "Crosstown Rebels", "Diynamic Music", "Get Physical Music",
        "Drumcode Records", "Time Warp", "Awakenings", "Kompakt",
      ],
      Headsy: ["Warp Records", "Ninja Tune", "Hyperdub", "Perlon"],
      "Business Techno": ["Kompakt", "Drumcode Records"],
      "Shelling Techno": ["Minus (record label)", "Ostgut Ton"],
      DNB: ["Let it Roll", "Hospital Records", "Metalheadz"],
      Techno: ["Kompakt", "Drumcode", "Minus", "Ostgut Ton", "Time Warp", "Awakenings", "Berghain", "Movement Electronic"],
    });
    assert.equal(parsed.columns.find((c) => c.tab === "Labels" && c.column === "Techno")!.origin, "heading");
    assert.deepEqual(columnMap(parsed, "Other")["Wide radio"], ["Mixmag", "MTV", "Pandora Radio", "The Fader"]);
    const v1 = parsed.columns.find((c) => c.column === "Prospecting - Previous v1")!;
    assert.equal(v1.origin, "row");
    assert.deepEqual(v1.names.slice(0, 3), ["Techno (music)", "Hardtechno", "Masters of Hardcore"]);
    assert.deepEqual(
      parsed.stray.map((s) => `${s.tab} ${s.cell}`),
      ["Labels H22", "Labels H23", "Labels H24", "Labels H25", "Labels H26", "Labels H27", "Artists M42", "Festivals Venues M15"],
    );
  });

  it("the committed workbook carries no comments, and the import never reads them", () => {
    const buf = readFileSync(join(ROOT, "docs/analysis/meta-interest-targets-library.xlsx"));
    const wb = XLSX.read(buf, { bookFiles: true }) as XLSX.WorkBook & { keys?: string[] };
    assert.deepEqual((wb.keys ?? []).filter((k) => /comment|person/i.test(k)), []);
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      for (const ref of Object.keys(sheet)) {
        if (!ref.startsWith("!")) assert.equal((sheet[ref] as XLSX.CellObject).c, undefined, `${name}!${ref}`);
      }
    }
    assert.ok((wb.keys ?? []).some((k) => /worksheets\/sheet1\.xml$/.test(k)), "bookFiles lists the zip entries");
  });

  it("splits cells on commas and ' or ', and sets Employers fragments apart", () => {
    assert.deepEqual(splitLibraryCell("Crosstown Rebels,"), { names: ["Crosstown Rebels"], employers: [] });
    assert.deepEqual(splitLibraryCell("Another Magazine, I.D. (magazine) or Ann Demeulemeester, Employers: BALENCIAGA or GQ"), {
      names: ["Another Magazine", "I.D. (magazine)", "Ann Demeulemeester"],
      employers: ["BALENCIAGA", "GQ"],
    });
    assert.deepEqual(splitLibraryCell("Stereo\u200Bgum,").names, ["Stereogum"]);
  });

  it("resolves exact first, then a whole-word contains on the top hit, else nothing", () => {
    const hits = [
      { id: "1", name: "Balenciaga (fashion brand)" },
      { id: "2", name: "balenciaga" },
    ];
    assert.deepEqual(resolveInterestName("Balenciaga", hits), { id: "2", name: "balenciaga", match: "exact" });
    assert.deepEqual(resolveInterestName("Balenciaga", hits.slice(0, 1)), {
      id: "1",
      name: "Balenciaga (fashion brand)",
      match: "contains",
    });
    assert.equal(resolveInterestName("Graff", [{ id: "3", name: "Graffiti" }]), null);
    assert.deepEqual(resolveInterestName("Bvlgari", [{ id: "4", name: "Bulgari (luxury goods)" }]), {
      id: "4",
      name: "Bulgari (luxury goods)",
      match: "contains",
    });
    assert.equal(resolveInterestName("Luxury Hotels", [{ id: "6", name: "small luxury hotels world" }]), null);
    assert.equal(
      resolveInterestName("Luxury Hotels", [{ id: "6", name: "small luxury hotels world" }, { id: "7", name: "Hotel" }]),
      null,
    );
    assert.equal(resolveInterestName("Techno Music", [{ id: "5", name: "Techno (music)" }]), null);
    assert.equal(resolveInterestName("Marshmello", []), null);
  });

  it("skips Frequent flyers and Employers, maps the iPhone column, attaches evidence on a key match", () => {
    const parsed = parseLibrarySheet("Other Updated", [
      ["Mags", "Frequent flyers", "Latest phone users", "Fashion"],
      ["Mixmag,", "Frequent flyers", "Iphone 14 users", "GQ, Employers: GQ"],
    ]);
    const chat: LibraryChatCluster[] = [{ name: "Lifestyle", vertical: "lifestyle", names: ["Luxury Travel", "Nope"] }];
    const built = buildLibrary({
      parsed,
      chat,
      resolve: resolveFrom({ Mixmag: "6003182953366", GQ: "6003030212255", "Luxury Travel": "6003011087019" }),
      report: REPORT,
      seeds: [{ name: "Latest iPhone users", interestIds: ["6002944044446"] }],
    });
    const names = built.rows.map((r) => r.name);
    assert.deepEqual(names, ["Other — Mags", "Other — Fashion", "Lifestyle"]);
    assert.ok(built.skipped.some((s) => s.column === "Frequent flyers" && /behaviour/.test(s.reason)));
    assert.ok(built.skipped.some((s) => s.name === "Employers: GQ" && /work_employers/.test(s.reason)));
    assert.deepEqual(built.mapped, [{ tab: "Other", column: "Latest phone users", to: "Latest iPhone users" }]);
    assert.equal(names.some((n) => /phone/i.test(n)), false);

    const mags = built.rows[0];
    assert.equal(mags.evidence?.clusterKey, "6003182953366");
    assert.equal(mags.evidence?.adSets, REPORT.clusters.find((c) => c.key === "6003182953366")!.adSets);
    assert.equal(built.rows[1].evidence, null);
    const lifestyle = built.rows[2];
    assert.equal(lifestyle.vertical, "lifestyle");
    assert.deepEqual(lifestyle.unresolved, ["Nope"]);
  });

  it("does not import the single-interest Techno cluster or repeat a seeded interest set", () => {
    const parsed = parseLibrarySheet("Artists Updated", [["Techno", "Publications again"], ["Techno (music)", "Mixmag"]]);
    const built = buildLibrary({
      parsed,
      chat: [],
      resolve: resolveFrom({ "Techno (music)": "6002911345572", Mixmag: "6003182953366" }),
      report: REPORT,
      seeds: [{ name: "Publications", interestIds: ["6003182953366"] }],
    });
    assert.deepEqual(built.rows, []);
    assert.match(built.skipped[0].reason, /single-interest Techno \(music\)/);
    assert.equal(built.skipped[1].reason, "same interests as Publications");
  });

  it("migration 183 embeds the library seed verbatim with source library", () => {
    const rows: LibrarySeedRow[] = JSON.parse(read("docs/analysis/interest-library-seed.json"));
    const sql = read("supabase/migrations/183_interest_clusters_library.sql");
    assert.deepEqual(embeddedSeedJson(sql), rows);
    assert.match(sql, /'library',/);
    assert.match(sql, /on conflict \(user_id, name\) do nothing/);
    const seedNames = new Set((JSON.parse(read("docs/analysis/interest-templates-seed.json")) as { name: string }[]).map((s) => s.name));
    for (const r of rows) {
      assert.equal(seedNames.has(r.name), false, r.name);
      assert.ok(r.interests.length > 0, r.name);
    }
    assert.equal(new Set(rows.map((r) => r.name)).size, rows.length);
  });
});
