#!/usr/bin/env -S npx tsx
// Interest library → interest_clusters rows (source 'library'). Read-only
// against Meta: GET /search?type=adinterest, the call app/api/meta/interest-search makes.
//
//   npx tsx --env-file=.env.local scripts/import-interest-library.mts [--refresh]
//
// Reads docs/analysis/meta-interest-targets-library.xlsx ("… Updated" tabs)
// and the chat lists below. Writes:
//   docs/analysis/interest-library-seed.json
//   docs/analysis/interest-library-unresolved.md
//   supabase/migrations/183_interest_clusters_library.sql (embeds the seed JSON)
// Search responses are cached at scripts/out/interest-library-search/.
//
// Requires env: META_ACCESS_TOKEN.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import XLSX from "xlsx";

import { graphGetWithToken } from "../lib/meta/client.ts";
import { clusterSeedMigrationSql } from "../lib/analysis/cluster-seed-sql.ts";
import {
  buildLibrary,
  countUnresolved,
  libraryQueries,
  parseLibraryWorkbook,
  renderLibraryUnresolved,
  resolveInterestName,
  type LibraryChatCluster,
  type SearchHit,
} from "../lib/analysis/interest-library.ts";
import type { InterestReportJson } from "../lib/analysis/interest-performance.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT_DIR = path.join(ROOT, "docs/analysis");
const WORKBOOK = path.join(OUT_DIR, "meta-interest-targets-library.xlsx");
const CACHE = path.join(ROOT, "scripts/out/interest-library-search");
const REFRESH = process.argv.includes("--refresh");

const CHAT: LibraryChatCluster[] = [
  {
    name: "Prospecting - Fashionistas",
    vertical: "lifestyle",
    names: [
      "Maison Margiela", "Balenciaga", "GQ", "Raf Simons", "METAL Magazine", "Dazed & Confused",
      "Comme des Garçons", "Alexander Wang", "v magazine", "Damir Doma", "Yohji Yamamoto", "Rick Owens",
      "Another Magazine", "I.D.", "Ann Demeulemeester",
    ],
  },
  {
    name: "Prospecting - Luxury fashion",
    vertical: "lifestyle",
    names: [
      "Balenciaga", "Fendi", "Giorgio Armani", "Gucci", "Givenchy", "Burberry", "Prada", "Chanel", "Coco Chanel",
      "Moschino", "Louis Vuitton", "Versace", "Bottega Veneta", "Yves Saint Laurent", "Armani", "Christian Dior",
      "Luxury goods",
    ],
  },
  {
    name: "Lifestyle",
    vertical: "lifestyle",
    names: ["Luxury Travel", "Luxury Hotels", "Luxury Goods", "Four Seasons", "Ritz-Carlton"],
  },
  {
    name: "High end jewellers",
    vertical: "lifestyle",
    names: [
      "Cartier", "Tiffany & Co", "Harry Winston", "Chopard", "Van Cleef", "Graff", "David Yurman", "Buccellati",
      "Bvlgari", "Boucheron", "Rolex", "Audemars Piguet", "IWC", "Tag Heuer", "Hublot",
    ],
  },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function cachePath(query: string): string {
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "q";
  return path.join(CACHE, `${slug}-${Buffer.from(query.toLowerCase()).toString("hex").slice(0, 12)}.json`);
}

async function search(query: string, token: string): Promise<SearchHit[]> {
  const file = cachePath(query);
  if (!REFRESH && existsSync(file)) return (JSON.parse(readFileSync(file, "utf8")) as { hits: SearchHit[] }).hits;
  const res = await graphGetWithToken<{ data?: { id: string | number; name: string }[] }>(
    "/search",
    { type: "adinterest", q: query, limit: "25" },
    token,
  );
  const hits = (res.data ?? []).map((h) => ({ id: String(h.id), name: h.name }));
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ query, fetchedAt: new Date().toISOString(), hits }, null, 2)}\n`);
  await sleep(300);
  return hits;
}

function latestReport(): InterestReportJson | null {
  const files = readdirSync(OUT_DIR).filter((f) => /^interest-performance-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  return files.length ? (JSON.parse(readFileSync(path.join(OUT_DIR, files[files.length - 1]), "utf8")) as InterestReportJson) : null;
}

async function main() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("Missing META_ACCESS_TOKEN — run with --env-file=.env.local");

  const wb = XLSX.read(readFileSync(WORKBOOK));
  const sheets = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, defval: "", raw: false }),
  }));
  const parsed = parseLibraryWorkbook(sheets);

  const queries = libraryQueries(parsed, CHAT);
  const resolutions = new Map<string, ReturnType<typeof resolveInterestName>>();
  const topHits = new Map<string, string | null>();
  for (const q of queries) {
    const hits = await search(q, token);
    resolutions.set(q.toLowerCase(), resolveInterestName(q, hits));
    topHits.set(q.toLowerCase(), hits[0]?.name ?? null);
  }

  const seeds = JSON.parse(readFileSync(path.join(OUT_DIR, "interest-templates-seed.json"), "utf8")) as {
    name: string;
    interestIds: string[];
  }[];
  const built = buildLibrary({
    parsed,
    chat: CHAT,
    resolve: (name) => resolutions.get(name.toLowerCase()) ?? null,
    report: latestReport(),
    seeds,
  });

  const rowsJson = `${JSON.stringify(built.rows, null, 2)}\n`;
  writeFileSync(path.join(OUT_DIR, "interest-library-seed.json"), rowsJson);
  writeFileSync(
    path.join(OUT_DIR, "interest-library-unresolved.md"),
    renderLibraryUnresolved(built, parsed.stray, path.relative(ROOT, WORKBOOK), (n) => topHits.get(n.toLowerCase()) ?? null),
  );
  writeFileSync(
    path.join(ROOT, "supabase/migrations/183_interest_clusters_library.sql"),
    clusterSeedMigrationSql({
      number: 183,
      source: "library",
      rowsJson,
      header: [
        "Migration 183 — interest library clusters for the operator",
        "",
        "Rows are docs/analysis/interest-library-seed.json, embedded verbatim",
        "between the $seed$ tags. Regenerate both with:",
        "  npx tsx --env-file=.env.local scripts/import-interest-library.mts",
        "Unresolved and skipped names: docs/analysis/interest-library-unresolved.md.",
        "",
        "Idempotent on (user_id, name). Skips with a notice when the operator",
        "user is absent. Requires migrations 181 and 182. Apply manually after review.",
      ],
    }),
  );
  const unresolved = countUnresolved(built);
  console.log(
    `${queries.length} names searched; ${built.rows.length} library clusters, ${unresolved} unresolved names, ${built.skipped.length} skipped, ${built.mapped.length} mapped, ${parsed.stray.length} stray cells`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
