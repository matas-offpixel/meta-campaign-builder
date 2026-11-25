/**
 * lib/artist-library/answer.ts — get_artist's plain-text answer (AL5).
 *
 * In AL2's order: the summary and Drive folder, the rights lines Claude
 * can't miss, shows, best per stage, other files, captions, insights, and
 * the Instagram rule last. Every line is a row of the AL word list.
 *
 * Pure.
 */
import { londonToday } from "../drive/tree.ts";
import { badgeWords } from "./rights.ts";
import { forEvent, isStale, type ArtistView, type ShowRow } from "./view.ts";
import { AL_WORDS, KIND_WORDS, PHASE_WORDS, alWord, costWords, countWords, dayWords, monthSpan, monthWords, spendFigure, STAGE_LABEL, RANKED_STAGES } from "./words.ts";

/** How many ranked files get_artist lists per stage: the library's top five. */
export const ANSWER_PER_STAGE = 5;

export function driveFileLink(id: string): string {
  return `https://drive.google.com/file/d/${id}`;
}

export function driveFolderLink(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

/** A row whose {link} has nothing to point at (an ad run from Ads Manager has no Drive file) ends before it. */
function withLink(line: string, link: string | null): string {
  return link ? line : line.replace(/ · $/, "");
}

/** An empty fill-in drops its " · " (a show with no venue). */
function tidy(line: string): string {
  return line.replace(/( · )+(?= · |$)/g, "").replace(/ ·  · /g, " · ");
}

export interface AnswerInput {
  artist: { id: string; name: string };
  view: ArtistView;
  clientName: (clientId: string | null) => string;
  /** The event asked about, when there is one. */
  event: { code: string; clientId: string | null } | null;
  driveFolderId: string | null;
  today: string;
}

function resultsWords(show: ShowRow): string {
  const parts: string[] = [];
  if (show.signups > 0) parts.push(countWords("signups", show.signups));
  if (show.purchases > 0) parts.push(countWords("purchases", show.purchases));
  if (!parts.length) parts.push(countWords("purchases", 0));
  return parts.join(" · ");
}

export function artistAnswer(input: AnswerInput): string {
  const { artist, view, today } = input;
  const eventClient = input.event?.clientId ?? null;
  const use = forEvent(view, input.event ? eventClient : null);
  const out: string[] = [artist.name];

  // Line 2: the counts, and a show still to come.
  const shows = countWords("shows", view.counted.shows);
  const clients = countWords("clients", view.counted.clients);
  const next = view.shows.find((s) => s.comingUp && s.code === input.event?.code) ?? view.shows.filter((s) => s.comingUp).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0];
  out.push(next ? alWord("al.mcp.summary.next", { shows, clients, code: next.code }) : alWord("al.mcp.summary", { shows, clients }));
  out.push(input.driveFolderId ? alWord("al.mcp.drive", { artist: artist.name, link: driveFolderLink(input.driveFolderId) }) : alWord("al.page.drive.none", { artist: artist.name }));

  // Rights, before the shows.
  out.push("");
  if (input.event) {
    const client = input.clientName(eventClient);
    out.push(alWord("al.mcp.rights", { code: input.event.code, client }));
    out.push(alWord("al.mcp.listed", { client }));
    for (const [clientId, n] of [...use.held].sort((a, b) => input.clientName(a[0]).localeCompare(input.clientName(b[0])))) {
      const other = input.clientName(clientId);
      out.push(n === 1 ? alWord("al.mcp.held.one", { other }) : alWord("al.mcp.held", { n, other }));
    }
    const others = [...new Set<string>([...use.held.keys(), ...view.shows.map((s) => s.clientId).filter((id): id is string => Boolean(id))])].filter((id) => id !== eventClient);
    for (const other of others.map(input.clientName).sort()) out.push(alWord("al.mcp.names", { other, client }));
  } else {
    out.push(AL_WORDS["al.mcp.rights.none"]);
  }

  // Shows with spend on the artist's ads.
  const counted = view.shows.filter((s) => !s.comingUp);
  if (counted.length) {
    out.push("", AL_WORDS["al.mcp.shows"]);
    for (const show of counted) {
      const common = { code: show.code, client: input.clientName(show.clientId), s: spendFigure(show.spend), artist: artist.name, results: resultsWords(show) };
      if (show.adsOnly) {
        const span = monthSpan(show.adsOnly.first, show.adsOnly.last);
        out.push(alWord("al.mcp.show.adsonly", { ...common, "first month": span.first, "last month": span.last }));
      } else {
        out.push(
          tidy(
            alWord("al.mcp.show", {
              ...common,
              venue: show.venue ?? "",
              date: show.date ? dayWords(show.date, today, true) : "",
              phase: show.phase ? PHASE_WORDS[show.phase] : "",
            }),
          ),
        );
      }
    }
  }

  const badge = (x: { shareable: boolean; heldReason: AnswerHeld; clientId: string | null }) => badgeWords(x, input.clientName(x.clientId)).badge;

  for (const stage of RANKED_STAGES) {
    const ranked = use.ranked[stage].slice(0, ANSWER_PER_STAGE);
    if (!ranked.length) continue;
    out.push("", alWord("al.mcp.best", { stage: STAGE_LABEL[stage] }));
    ranked.forEach((r, i) => {
      const link = r.group.driveFileId ? driveFileLink(r.group.driveFileId) : null;
      out.push(
        withLink(
          alWord("al.mcp.asset", { rank: i + 1, name: r.group.name, kind: KIND_WORDS[r.group.kind], code: r.group.code ?? "", cost: costWords(stage, r.cost), badge: badge(r.group), link: link ?? "" }),
          link,
        ),
      );
    });
  }

  if (use.other.length) {
    out.push("", AL_WORDS["al.mcp.other"]);
    for (const g of use.other) {
      const link = g.driveFileId ? driveFileLink(g.driveFileId) : null;
      out.push(withLink(alWord("al.mcp.other.row", { name: g.name, kind: KIND_WORDS[g.kind], badge: badge(g), link: link ?? "" }), link));
    }
  }

  if (use.captions.length) {
    out.push("", AL_WORDS["al.mcp.captions"]);
    for (const c of use.captions) {
      out.push(alWord("al.mcp.caption", { caption: c.text, approver: c.approvedBy, date: dayWords(londonToday(new Date(c.approvedAt)), today), badge: badge(c) }));
    }
  }

  // AL3's insights are built in PR 2; until then there are none.
  out.push("", AL_WORDS["al.mcp.insights.none"]);

  out.push("");
  if (!use.newestAt) out.push(alWord("al.page.empty", { artist: artist.name }));
  else {
    const month = monthWords(use.newestAt.slice(0, 10));
    out.push(isStale(use.newestAt, today) ? alWord("al.mcp.old", { "month year": month }) : alWord("al.mcp.fresh", { "month year": month }));
  }
  return out.join("\n");
}

type AnswerHeld = Parameters<typeof badgeWords>[0]["heldReason"];

/** No artist by that name: AL5's two lines. */
export function unknownArtistAnswer(name: string, closest: readonly string[]): string {
  const lines = [alWord("al.mcp.unknown", { name })];
  if (closest.length) lines.push(alWord("al.mcp.closest", { names: closest.join(", ") }));
  return lines.join("\n");
}
