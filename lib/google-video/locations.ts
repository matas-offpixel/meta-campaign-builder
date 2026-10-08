/**
 * lib/google-video/locations.ts
 *
 * Location IDs for the Editor file. Every entry was checked by ID, name
 * and target type against Google's geotargets CSV of 2026-08-12
 * (https://developers.google.com/google-ads/api/data/geotargets).
 * Deliberately not `GEO_TARGET_CONSTANTS_MAP` in lib/google-ads: on that
 * date its region and most of its city IDs were other places (9049069 is
 * Estepona, Spain).
 *
 * `Location` is Google's canonical name with ", " separators, which is
 * how Editor exported London. `type` is set only where Editor's export
 * showed the spelling (Country, City); otherwise Editor fills it in.
 *
 * Google has no "South East England" (or any other English region)
 * target. A name not listed here is left out of the file with a warning.
 */

export interface EditorLocation {
  id: string;
  location: string;
  type: "Country" | "City" | null;
}

const LOCATIONS: ReadonlyArray<{ keys: string[] } & EditorLocation> = [
  { keys: ["united kingdom", "uk", "great britain"], id: "2826", location: "United Kingdom", type: "Country" },
  { keys: ["england"], id: "20339", location: "England, United Kingdom", type: null },
  { keys: ["scotland"], id: "20342", location: "Scotland, United Kingdom", type: null },
  { keys: ["wales"], id: "20343", location: "Wales, United Kingdom", type: null },
  { keys: ["northern ireland"], id: "20341", location: "Northern Ireland, United Kingdom", type: null },
  { keys: ["london", "greater london"], id: "1006886", location: "London, England, United Kingdom", type: "City" },
  { keys: ["manchester"], id: "1006912", location: "Manchester, Manchester, England, United Kingdom", type: "City" },
  { keys: ["birmingham"], id: "1006524", location: "Birmingham, West Midlands, England, United Kingdom", type: "City" },
  { keys: ["leeds"], id: "1006864", location: "Leeds, West Yorkshire, England, United Kingdom", type: "City" },
  { keys: ["liverpool"], id: "1006884", location: "Liverpool, England, United Kingdom", type: "City" },
  { keys: ["bristol"], id: "1006567", location: "Bristol, England, United Kingdom", type: "City" },
  { keys: ["brighton"], id: "1006565", location: "Brighton, England, United Kingdom", type: "City" },
  { keys: ["sheffield"], id: "1007064", location: "Sheffield, South Yorkshire, England, United Kingdom", type: "City" },
  { keys: ["nottingham"], id: "1006965", location: "Nottingham, Nottingham, England, United Kingdom", type: "City" },
  { keys: ["leicester"], id: "1006867", location: "Leicester, Leicester, England, United Kingdom", type: "City" },
  { keys: ["newcastle", "newcastle upon tyne"], id: "1006948", location: "Newcastle upon Tyne, Newcastle upon Tyne, England, United Kingdom", type: "City" },
  { keys: ["edinburgh"], id: "1007326", location: "Edinburgh, Scotland, United Kingdom", type: "City" },
  { keys: ["glasgow"], id: "1007336", location: "Glasgow, Scotland, United Kingdom", type: "City" },
  { keys: ["cardiff"], id: "1007416", location: "Cardiff, Wales, United Kingdom", type: "City" },
  { keys: ["belfast"], id: "1007274", location: "Belfast, Northern Ireland, United Kingdom", type: "City" },
  { keys: ["ireland"], id: "2372", location: "Ireland", type: "Country" },
  { keys: ["germany"], id: "2276", location: "Germany", type: "Country" },
  { keys: ["france"], id: "2250", location: "France", type: "Country" },
  { keys: ["netherlands"], id: "2528", location: "Netherlands", type: "Country" },
  { keys: ["spain"], id: "2724", location: "Spain", type: "Country" },
  { keys: ["italy"], id: "2380", location: "Italy", type: "Country" },
  { keys: ["belgium"], id: "2056", location: "Belgium", type: "Country" },
];

const BY_KEY = new Map(LOCATIONS.flatMap(({ keys, ...loc }) => keys.map((k) => [k, loc] as const)));

export function editorLocation(name: string): EditorLocation | null {
  return BY_KEY.get(name.toLowerCase().trim().replace(/\s+/g, " ")) ?? null;
}
