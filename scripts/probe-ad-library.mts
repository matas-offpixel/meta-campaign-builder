// scripts/probe-ad-library.mts
//
// PR3a, the Ad Library probe for E9 (the inspiration feed). Read-only.
//
// Asks Graph `ads_archive` for the ads of a few watchlist pages and prints one
// markdown table: per page and per `ad_reached_countries`, the HTTP status,
// rows returned, earliest and latest `ad_delivery_start_time`, and the error
// body when Meta refuses. The answer decides whether E9 can read the Ad Library
// from the app, or needs the interim weekly Claude task writing into the
// app's store (North Star issue 3, §9.5).
//
// Every page is asked for ['GB'] and ['IE','FR']. The derived artist (an act a
// watched promoter advertises) is also asked for ['US'], to see whether
// country-level filtering works for an artist page.
//
// No writes, no table, no cron. The token is read from the environment and is
// never printed: it is stripped from every error body before output.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/probe-ad-library.mts
//   npx tsx --env-file=.env.local scripts/probe-ad-library.mts --token-env OTHER_TOKEN_VAR
//   npx tsx --env-file=.env.local scripts/probe-ad-library.mts --max-pages 2

const API_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;
const PAGE_SIZE = 100;

// Page ids, resolved read-only on 23 Nov 2026:
// - Broadwick Live and Labyrinth: the Meta Ads connector's `ads_library_search`
//   (GB), from their own ads' `page_id` (Broadwick's "David Morales | Sat 20 Feb"
//   ads; Labyrinth's "Kelvin Momo Live", GBP).
// - Fever, DICE, Nike and Dj David Morales: the Ad Library UI's advertiser
//   typeahead (country GB), the `view_all_page_id` of the page opened.
//   Fever is @FeverUpUK (the UK page, not @feverup). DICE is @dicefm. There is
//   no Nike UK page in the typeahead; @nike is the page that runs UK ads.
// Graph `/{username}` lookups were refused (code 100 subcode 33, or code 10 for
// lack of Page Public Metadata Access), so the ids could not come from Graph.
const WATCHLIST = [
  { name: "Broadwick Live", pageId: "314321628698217", kind: "promoter" },
  { name: "Labyrinth", pageId: "351513758542317", kind: "promoter" },
  { name: "Fever (UK)", pageId: "385660324877550", kind: "ticketing" },
  { name: "DICE", pageId: "258747834283158", kind: "ticketing" },
  { name: "Nike", pageId: "15087023444", kind: "brand" },
  // Derived artist: Broadwick Live advertises "David Morales | Sat 20 Feb".
  { name: "Dj David Morales", pageId: "443532440172", kind: "derived_artist" },
] as const;

type WatchPage = (typeof WATCHLIST)[number];

const FIELDS = [
  "id",
  "page_name",
  "ad_creation_time",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "ad_creative_bodies",
  "ad_snapshot_url",
  "publisher_platforms",
  "languages",
].join(",");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tokenEnv = arg("--token-env") ?? "META_ACCESS_TOKEN";
const maxPages = Number(arg("--max-pages") ?? "5");
const token = process.env[tokenEnv];
if (!token) throw new Error(`${tokenEnv} is not set`);

function redact(text: string): string {
  return token ? text.split(token).join("<token>") : text;
}

type ArchiveRow = { ad_delivery_start_time?: string };

type ProbeResult = {
  page: WatchPage;
  countries: string[];
  status: number;
  rows: number;
  pages: number;
  truncated: boolean;
  earliest: string | null;
  latest: string | null;
  error: string | null;
};

function countriesFor(page: WatchPage): string[][] {
  const sets = [["GB"], ["IE", "FR"]];
  if (page.kind === "derived_artist") sets.splice(1, 0, ["US"]);
  return sets;
}

async function probe(page: WatchPage, countries: string[]): Promise<ProbeResult> {
  const url = new URL(`${GRAPH}/ads_archive`);
  url.searchParams.set("ad_type", "ALL");
  url.searchParams.set("ad_active_status", "ALL");
  url.searchParams.set("ad_reached_countries", JSON.stringify(countries));
  url.searchParams.set("search_page_ids", JSON.stringify([page.pageId]));
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("access_token", token!);

  const starts: string[] = [];
  let next: string | null = url.toString();
  let status = 0;
  let pages = 0;
  let error: string | null = null;

  while (next && pages < maxPages) {
    const res = await fetch(next);
    status = res.status;
    const body = await res.text();
    if (!res.ok) {
      error = redact(body);
      break;
    }
    const json = JSON.parse(body) as { data?: ArchiveRow[]; paging?: { next?: string } };
    for (const row of json.data ?? []) if (row.ad_delivery_start_time) starts.push(row.ad_delivery_start_time);
    pages += 1;
    next = json.paging?.next ?? null;
  }

  starts.sort();
  return {
    page,
    countries,
    status,
    rows: starts.length,
    pages,
    truncated: Boolean(next),
    earliest: starts[0] ?? null,
    latest: starts.at(-1) ?? null,
    error,
  };
}

function cell(text: string | null): string {
  return (text ?? "–").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function main(): Promise<void> {
  const results: ProbeResult[] = [];
  for (const page of WATCHLIST) {
    for (const countries of countriesFor(page)) results.push(await probe(page, countries));
  }

  console.log(`ads_archive probe · ${API_VERSION} · token from ${tokenEnv} · ad_type=ALL · ${new Date().toISOString()}\n`);
  console.log("| Page | Kind | Page id | ad_reached_countries | HTTP | Rows | Earliest start | Latest start | Error body |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const rows = r.error ? "–" : `${r.rows}${r.truncated ? "+" : ""}`;
    console.log(
      `| ${r.page.name} | ${r.page.kind} | ${r.page.pageId} | ${JSON.stringify(r.countries)} | ${r.status} | ${rows} | ${cell(r.earliest)} | ${cell(r.latest)} | ${cell(r.error)} |`,
    );
  }

  const refused = results.filter((r) => r.error);
  const gb = results.filter((r) => r.countries.join() === "GB" && !r.error);
  const eu = results.filter((r) => r.countries.join() === "IE,FR" && !r.error);
  console.log("");
  if (refused.length === results.length) {
    console.log(`Every call was refused (${refused.length}/${results.length}). The token cannot read ads_archive.`);
  } else {
    console.log(`GB calls with rows: ${gb.filter((r) => r.rows > 0).length}/${gb.length}`);
    console.log(`IE/FR calls with rows: ${eu.filter((r) => r.rows > 0).length}/${eu.length}`);
  }
}

await main();
