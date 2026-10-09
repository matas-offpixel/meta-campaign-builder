/**
 * lib/google-ads/verified-geotargets.ts
 *
 * One location list for the Search fallback map and the YouTube Editor
 * file. Every ID was checked against Google's geotargets CSV of
 * 2026-08-12 (Criteria ID, Name, Canonical Name, Country Code, Target
 * Type, Status), copied into
 * `__tests__/fixtures/geotargets-2026-08-12-verified.csv`.
 *
 * English region names are not in that list as regions. The CSV has a
 * few different targets with similar labels (West Midlands the county,
 * and TV regions such as East Of England). Those IDs are not used.
 * 9049069 is Estepona, Spain.
 */

export interface VerifiedGeotarget {
  /** Lookup keys, already lowercase. */
  keys: readonly string[];
  id: string;
  /** Editor's Location cell, with ", " separators, as Editor exported it. */
  editorLocation: string;
  /** Set only where an Editor export showed Country or City. */
  editorType: "Country" | "City" | null;
}

export const VERIFIED_GEOTARGETS: readonly VerifiedGeotarget[] = [
  { keys: ["united kingdom", "uk", "great britain"], id: "2826", editorLocation: "United Kingdom", editorType: "Country" },
  { keys: ["england"], id: "20339", editorLocation: "England, United Kingdom", editorType: null },
  { keys: ["scotland"], id: "20342", editorLocation: "Scotland, United Kingdom", editorType: null },
  { keys: ["wales"], id: "20343", editorLocation: "Wales, United Kingdom", editorType: null },
  { keys: ["northern ireland"], id: "20341", editorLocation: "Northern Ireland, United Kingdom", editorType: null },
  { keys: ["london", "greater london"], id: "1006886", editorLocation: "London, England, United Kingdom", editorType: "City" },
  { keys: ["manchester"], id: "1006912", editorLocation: "Manchester, Manchester, England, United Kingdom", editorType: "City" },
  { keys: ["birmingham"], id: "1006524", editorLocation: "Birmingham, West Midlands, England, United Kingdom", editorType: "City" },
  { keys: ["leeds"], id: "1006864", editorLocation: "Leeds, West Yorkshire, England, United Kingdom", editorType: "City" },
  { keys: ["liverpool"], id: "1006884", editorLocation: "Liverpool, England, United Kingdom", editorType: "City" },
  { keys: ["bristol"], id: "1006567", editorLocation: "Bristol, England, United Kingdom", editorType: "City" },
  { keys: ["brighton"], id: "1006565", editorLocation: "Brighton, England, United Kingdom", editorType: "City" },
  { keys: ["sheffield"], id: "1007064", editorLocation: "Sheffield, South Yorkshire, England, United Kingdom", editorType: "City" },
  { keys: ["nottingham"], id: "1006965", editorLocation: "Nottingham, Nottingham, England, United Kingdom", editorType: "City" },
  { keys: ["leicester"], id: "1006867", editorLocation: "Leicester, Leicester, England, United Kingdom", editorType: "City" },
  { keys: ["newcastle", "newcastle upon tyne"], id: "1006948", editorLocation: "Newcastle upon Tyne, Newcastle upon Tyne, England, United Kingdom", editorType: "City" },
  { keys: ["edinburgh"], id: "1007326", editorLocation: "Edinburgh, Scotland, United Kingdom", editorType: "City" },
  { keys: ["glasgow"], id: "1007336", editorLocation: "Glasgow, Scotland, United Kingdom", editorType: "City" },
  { keys: ["cardiff"], id: "1007416", editorLocation: "Cardiff, Wales, United Kingdom", editorType: "City" },
  { keys: ["belfast"], id: "1007274", editorLocation: "Belfast, Northern Ireland, United Kingdom", editorType: "City" },
  { keys: ["ireland"], id: "2372", editorLocation: "Ireland", editorType: "Country" },
  { keys: ["germany"], id: "2276", editorLocation: "Germany", editorType: "Country" },
  { keys: ["france"], id: "2250", editorLocation: "France", editorType: "Country" },
  { keys: ["netherlands"], id: "2528", editorLocation: "Netherlands", editorType: "Country" },
  { keys: ["spain"], id: "2724", editorLocation: "Spain", editorType: "Country" },
  { keys: ["italy"], id: "2380", editorLocation: "Italy", editorType: "Country" },
  { keys: ["belgium"], id: "2056", editorLocation: "Belgium", editorType: "Country" },
];

/**
 * Names the old fallback map sent to other places. Google's CSV has no
 * English region of these names. A county or TV region with a similar
 * label is not used.
 */
export const ENGLISH_REGION_KEYS: readonly string[] = [
  "south east england",
  "south east",
  "south west england",
  "south west",
  "east of england",
  "east midlands",
  "west midlands",
  "yorkshire and the humber",
  "north west england",
  "north west",
  "north east england",
  "north east",
];

const ENGLISH_REGIONS = new Set(ENGLISH_REGION_KEYS);

export function normaliseLocationKey(location: string): string {
  return location.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Set when the name is an English region. Otherwise null. */
export function englishRegionWarning(location: string): string | null {
  if (!ENGLISH_REGIONS.has(normaliseLocationKey(location))) return null;
  return `Google has no English region target for "${location.trim()}". It was left out.`;
}
