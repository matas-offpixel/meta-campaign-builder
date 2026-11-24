/**
 * The seed for Electric's four audience templates (brief R6, record RC5):
 * proposed from past launches, printed by scripts/seed-audience-templates.mts,
 * written only after Matas confirms them (--apply).
 *
 * Each template's shows are the brief's, plus any event given a genre
 * family in the template's families (SeedEvent.genreFamily). The script
 * passes none: the genre key keeps the events' family to its shadow runner
 * (GK, guarded in lib/learning/__tests__/genre.test.ts), and on 24 Nov no
 * Electric event had one. Each show is printed with where it came from.
 *
 * From those shows' drafts it takes:
 *   - Artist page engagers: the pages in their page groups, except venue
 *     groups (the venue's own pages aren't artist pages) and the groups the
 *     template leaves out ("less disco"); plus crossover groups from any
 *     Electric show, and the pages the brief names. Ranked by how many of
 *     the template's shows used the page. tag_performance has no audience
 *     or page dimension, so there's no n to rank pages by.
 *   - Interests: the interests in their interest groups that at least two of
 *     the shows used (all of them with one show). Ranked by the Electric
 *     slice of interest_clusters.live_evidence when a cluster holding the
 *     interest reads ok or better, then by shows.
 *   - Customer lists: Electric's genre lists as Meta holds them (ops, 24 Nov:
 *     TEMPLATE_LISTS in graph-lists.ts), each saved with its Meta id and the
 *     account that holds it. They're never re-uploaded: an account that
 *     can't use one gets it shared. A list Meta didn't return is saved by
 *     role and family only.
 *   - Retargeting pools: by role, from the brief, resolved in each account.
 *
 * Genre keys are the code's (lib/learning/genre/families.ts), as design
 * ruled in RC5: melodic_prog, commercial.
 *
 * Pure. No `@/` imports, so node --test can load it.
 */

import type { GenrePoolKey } from "../learning/genre/families.ts";
import { NAMED_LISTS, TEMPLATE_LISTS, type ListPlacement } from "./graph-lists.ts";
import type { AudienceTemplate, TemplateItem } from "./resolve.ts";
import { TEMPLATE_NAMES } from "./words.ts";

export interface SeedEvent {
  id: string;
  code: string;
  name: string;
  genreFamily: string | null;
}

export interface SeedDraft {
  eventId: string;
  status: string;
  audiences: unknown;
}

export interface SeedCluster {
  name: string;
  interestIds: string[];
  /** The client's slice of live_evidence, when there is one. */
  cprIndex: number | null;
  confidence: string | null;
}

export interface TemplateDef {
  name: string;
  families: GenrePoolKey[];
  /** The brief's shows, by event code. */
  briefShows: string[];
  /** Page groups from the template's own shows to leave out. */
  excludeGroups: RegExp[];
  /** Page groups taken from any of the client's shows (crossover). */
  crossoverGroups: RegExp[];
  /** Pages the brief names, by name. */
  mustPages: string[];
}

/** Retargeting pools, in every template: Electric's past windows (30 / 180 days, 75% · 60 days). */
export const POOLS: ReadonlyArray<{ role: "page_views" | "signups" | "video_viewers"; days: number; threshold?: number }> = [
  { role: "page_views", days: 30 },
  { role: "signups", days: 180 },
  { role: "video_viewers", days: 60, threshold: 75 },
];

const VENUE_GROUP = /venue/i;

export const TEMPLATE_DEFS: readonly TemplateDef[] = [
  {
    name: TEMPLATE_NAMES[0],
    families: ["house_tech", "disco"],
    briefShows: ["NX26-LOCKLEAD", "NX27-EWANMCVICAR", "NX26-FOLAMOUR", "NX26-ROBBIEDOHERTY", "NX27-JULIANFIJMA"],
    excludeGroups: [],
    crossoverGroups: [],
    mustPages: [],
  },
  {
    name: TEMPLATE_NAMES[1],
    families: ["garage_bass", "house_tech"],
    briefShows: ["NX27-SILVABUMPA", "NX26-IPC"],
    excludeGroups: [/disco/i],
    crossoverGroups: [/garage/i, /techno/i, /dnb|d&b|drum/i, /bass|dubstep/i],
    mustPages: ["Mall Grab", "HAAI"],
  },
  {
    name: TEMPLATE_NAMES[2],
    families: ["techno", "hard_techno", "melodic_prog"],
    briefShows: ["NX26-AZYR", "NX26-SCHAK"],
    excludeGroups: [],
    crossoverGroups: [/techno/i, /trance|melodic/i],
    mustPages: ["Paul van Dyk", "Dave Pearce"],
  },
  {
    name: TEMPLATE_NAMES[3],
    families: ["commercial", "house_tech", "disco"],
    briefShows: ["NX26-DOD", "NX26-RUDIMENTAL"],
    excludeGroups: [],
    crossoverGroups: [/dnb|d&b|drum/i],
    mustPages: [],
  },
];

export interface SeedShow {
  code: string;
  name: string;
  source: "genre" | "brief";
  drafts: number;
}

export interface SeedPage {
  pageId: string;
  name: string | null;
  shows: string[];
  groups: string[];
  why: "show" | "crossover" | "brief";
}

export interface SeedInterest {
  id: string;
  name: string;
  shows: string[];
  evidence: { cluster: string; cprIndex: number; confidence: string } | null;
}

export interface SeedProposal {
  def: TemplateDef;
  shows: SeedShow[];
  missingShows: string[];
  pages: SeedPage[];
  missingPages: string[];
  interests: SeedInterest[];
  template: AudienceTemplate;
}

interface PageGroupLike {
  name?: unknown;
  pageIds?: unknown;
  engagementAudienceStatuses?: unknown;
}
interface InterestGroupLike {
  name?: unknown;
  interests?: unknown;
}

function pageGroups(audiences: unknown): PageGroupLike[] {
  const g = (audiences as { pageGroups?: unknown } | null)?.pageGroups;
  return Array.isArray(g) ? (g as PageGroupLike[]) : [];
}

function interestGroups(audiences: unknown): InterestGroupLike[] {
  const g = (audiences as { interestGroups?: unknown } | null)?.interestGroups;
  return Array.isArray(g) ? (g as InterestGroupLike[]) : [];
}

function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^\d+$/.test(x)) : [];
}

/** Page names the drafts recorded at launch (engagementAudienceStatuses[].pageName). */
export function pageNamesFromDrafts(drafts: SeedDraft[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of drafts) {
    for (const g of pageGroups(d.audiences)) {
      const statuses = Array.isArray(g.engagementAudienceStatuses) ? g.engagementAudienceStatuses : [];
      for (const s of statuses as Array<Record<string, unknown>>) {
        const id = typeof s.pageId === "string" ? s.pageId : null;
        const name = typeof s.pageName === "string" ? s.pageName.trim() : "";
        if (id && name && !out[id]) out[id] = name;
      }
    }
  }
  return out;
}

function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The page whose name is `wanted` (spacing, case and punctuation ignored; "Mall Grab / Jordon Alexander" counts). */
export function findPageByName(wanted: string, names: Record<string, string>): string | null {
  const key = nameKey(wanted);
  const hits = Object.entries(names).filter(([, n]) => {
    const k = nameKey(n);
    return k === key || nameKey(n.split("/")[0] ?? "") === key;
  });
  hits.sort(([a], [b]) => a.localeCompare(b));
  return hits[0]?.[0] ?? null;
}

const EVIDENCE_OK = new Set(["ok", "good", "strong"]);

function pageItem(p: SeedPage): TemplateItem {
  return {
    kind: "page_engagers",
    listRole: null,
    familyKey: null,
    pageId: p.pageId,
    retentionDays: 365,
    interestId: null,
    interestName: null,
    metaAudienceId: null,
    detail: { name: p.name ?? undefined, shows: p.shows },
  };
}

export interface SeedInput {
  clientId: string;
  businessId: string;
  events: SeedEvent[];
  drafts: SeedDraft[];
  pageNames: Record<string, string>;
  clusters: SeedCluster[];
  /** Where Electric's lists are in Meta (graph-lists.ts placeLists). */
  lists?: ListPlacement[];
  /** The shows' own pages per template, at most (the brief's and crossover pages are always kept). */
  pageCap?: number;
  /** Interests per template, at most. */
  interestCap?: number;
}

export function planTemplates(input: SeedInput): SeedProposal[] {
  const pageCap = input.pageCap ?? 30;
  const interestCap = input.interestCap ?? 12;
  const byCode = new Map(input.events.map((e) => [e.code, e]));
  const draftsByEvent = new Map<string, SeedDraft[]>();
  for (const d of input.drafts) draftsByEvent.set(d.eventId, [...(draftsByEvent.get(d.eventId) ?? []), d]);

  return TEMPLATE_DEFS.map((def): SeedProposal => {
    // Shows: the genre family first, then the brief's.
    const shows: SeedShow[] = [];
    const seen = new Set<string>();
    for (const e of input.events) {
      if (e.genreFamily && (def.families as readonly string[]).includes(e.genreFamily) && !seen.has(e.code)) {
        seen.add(e.code);
        shows.push({ code: e.code, name: e.name, source: "genre", drafts: draftsByEvent.get(e.id)?.length ?? 0 });
      }
    }
    const missingShows: string[] = [];
    for (const code of def.briefShows) {
      const e = byCode.get(code);
      if (!e) {
        missingShows.push(code);
        continue;
      }
      if (seen.has(code)) continue;
      seen.add(code);
      shows.push({ code, name: e.name, source: "brief", drafts: draftsByEvent.get(e.id)?.length ?? 0 });
    }
    const showEvents = shows.map((s) => byCode.get(s.code)!);

    // Pages from the shows' own groups. A page that sits in any venue group
    // is a venue page wherever it appears ("Lineup" groups carry them too).
    const venuePages = new Set<string>();
    for (const d of input.drafts) {
      for (const g of pageGroups(d.audiences)) {
        if (typeof g.name === "string" && VENUE_GROUP.test(g.name)) for (const id of ids(g.pageIds)) venuePages.add(id);
      }
    }
    const isCrossover = (group: string) => def.crossoverGroups.some((re) => re.test(group));
    const pages = new Map<string, SeedPage>();
    const addPage = (pageId: string, show: string | null, group: string | null, why: SeedPage["why"]) => {
      if (venuePages.has(pageId)) return;
      const p = pages.get(pageId) ?? { pageId, name: input.pageNames[pageId] ?? null, shows: [], groups: [], why };
      if (why === "crossover" && p.why === "show") p.why = "crossover";
      if (show && !p.shows.includes(show)) p.shows.push(show);
      if (group && !p.groups.includes(group)) p.groups.push(group);
      pages.set(pageId, p);
    };
    for (const e of showEvents) {
      for (const d of draftsByEvent.get(e.id) ?? []) {
        for (const g of pageGroups(d.audiences)) {
          const group = typeof g.name === "string" ? g.name.trim() : "";
          if (VENUE_GROUP.test(group) || def.excludeGroups.some((re) => re.test(group))) continue;
          for (const id of ids(g.pageIds)) addPage(id, e.code, group, isCrossover(group) ? "crossover" : "show");
        }
      }
    }
    // Crossover: those groups on any of the client's shows.
    if (def.crossoverGroups.length) {
      for (const e of input.events) {
        for (const d of draftsByEvent.get(e.id) ?? []) {
          for (const g of pageGroups(d.audiences)) {
            const group = typeof g.name === "string" ? g.name.trim() : "";
            if (!isCrossover(group) || VENUE_GROUP.test(group)) continue;
            for (const id of ids(g.pageIds)) addPage(id, null, group, "crossover");
          }
        }
      }
    }
    // The brief's pages, by name.
    const missingPages: string[] = [];
    const must: string[] = [];
    for (const wanted of def.mustPages) {
      const id = findPageByName(wanted, input.pageNames);
      if (!id) {
        missingPages.push(wanted);
        continue;
      }
      must.push(id);
      addPage(id, null, null, "brief");
      const hit = pages.get(id);
      if (hit) hit.why = "brief";
    }
    // The brief's pages and the crossover groups are what the brief asks for:
    // always kept. The shows' own pages fill up to the cap, most-used first.
    const order = (a: SeedPage, b: SeedPage) =>
      b.shows.length - a.shows.length || (a.name ?? a.pageId).localeCompare(b.name ?? b.pageId);
    const all = [...pages.values()];
    const keptPages = [
      ...all.filter((p) => p.why === "brief" || must.includes(p.pageId)).sort(order),
      ...all.filter((p) => p.why === "crossover" && !must.includes(p.pageId)).sort(order),
      ...all.filter((p) => p.why === "show" && !must.includes(p.pageId)).sort(order).slice(0, pageCap),
    ];

    // Interests.
    const interestShows = new Map<string, { name: string; shows: Set<string> }>();
    for (const e of showEvents) {
      for (const d of draftsByEvent.get(e.id) ?? []) {
        for (const g of interestGroups(d.audiences)) {
          const list = Array.isArray(g.interests) ? (g.interests as Array<Record<string, unknown>>) : [];
          for (const i of list) {
            const id = typeof i.id === "string" ? i.id : null;
            const name = typeof i.name === "string" ? i.name : null;
            if (!id || !name) continue;
            const hit = interestShows.get(id) ?? { name, shows: new Set<string>() };
            hit.shows.add(e.code);
            interestShows.set(id, hit);
          }
        }
      }
    }
    const withDrafts = shows.filter((s) => s.drafts > 0).length;
    const minShows = withDrafts > 1 ? 2 : 1;
    const interests: SeedInterest[] = [...interestShows.entries()]
      .filter(([, v]) => v.shows.size >= minShows)
      .map(([id, v]) => {
        const cluster = input.clusters
          .filter((c) => c.interestIds.includes(id) && c.cprIndex != null && c.confidence && EVIDENCE_OK.has(c.confidence))
          .sort((a, b) => a.cprIndex! - b.cprIndex!)[0];
        return {
          id,
          name: v.name,
          shows: [...v.shows].sort(),
          evidence: cluster ? { cluster: cluster.name, cprIndex: cluster.cprIndex!, confidence: cluster.confidence! } : null,
        };
      })
      .sort(
        (a, b) =>
          (a.evidence?.cprIndex ?? Infinity) - (b.evidence?.cprIndex ?? Infinity) ||
          b.shows.length - a.shows.length ||
          a.name.localeCompare(b.name),
      )
      .slice(0, interestCap);

    const lists = (TEMPLATE_LISTS[def.name] ?? []).flatMap((name) => {
      const named = NAMED_LISTS.find((l) => l.name === name);
      if (!named) return [];
      const placed = input.lists?.find((p) => p.list.name === name) ?? null;
      return [{ named, placed }];
    });
    const items: TemplateItem[] = [
      ...lists.map(
        ({ named, placed }): TemplateItem => ({
          kind: "customer_list",
          // Past ticket and signup data; Matas confirms the role.
          listRole: "buyers",
          familyKey: named.family,
          pageId: null,
          retentionDays: null,
          interestId: null,
          interestName: null,
          metaAudienceId: placed?.id ?? null,
          detail: placed?.id
            ? { name: placed.metaName ?? named.name, ...(placed.holder ? { heldIn: placed.holder } : {}) }
            : { name: named.name },
        }),
      ),
      ...POOLS.map(
        (p): TemplateItem => ({
          kind: "retargeting_pool",
          listRole: p.role,
          familyKey: null,
          pageId: null,
          retentionDays: p.days,
          interestId: null,
          interestName: null,
          metaAudienceId: null,
          detail: p.threshold != null ? { threshold: p.threshold } : {},
        }),
      ),
      ...keptPages.map(pageItem),
      ...interests.map(
        (i): TemplateItem => ({
          kind: "interest",
          listRole: null,
          familyKey: null,
          pageId: null,
          retentionDays: null,
          interestId: i.id,
          interestName: i.name,
          metaAudienceId: null,
          detail: { shows: i.shows },
        }),
      ),
    ];

    return {
      def,
      shows,
      missingShows,
      pages: keptPages,
      missingPages,
      interests,
      template: {
        name: def.name,
        businessId: input.businessId,
        clientId: input.clientId,
        genreFamilies: def.families,
        shows: shows.map((s) => showName(s.name)),
        confirmedBy: null,
        confirmedAt: null,
        items,
      },
    };
  });
}

/** "AZYR b2b Partiboi69" → "AZYR"; "Dave Pearce: Trance Anthems Day Party" → "Dave Pearce"; "Mall Grab - Sheffield" → "Mall Grab". */
export function showName(name: string): string {
  return name.split(/\s+b2b\s+|:|\s+-\s+/i)[0]!.trim();
}
