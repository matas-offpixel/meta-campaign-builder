/**
 * lib/render-templates/words.ts — M4's words, and the TD rows Today's log row uses.
 *
 * M4_WORDS is every row of scratch/mcp/words-m4-render-2026-11-25.tsv
 * (122 rows, sha256 c86c2fbd…5085; records 2026-11-25-m4-render-templates and
 * its re-ruling 2026-11-25-m4-renders-on-yes), exactly. TODAY_WORDS is the
 * nine rows of TD's list (scratch/mcp/words-mcp-today-2026-11-25.tsv) that
 * FC1's log row needs for a render package. The tests compare both with the
 * copied fixtures row by row. Nothing on a screen or told to Claude about a
 * render package is written anywhere else, except CLAUDE_CANDIDATES below:
 * Claude-facing lines no record has, each listed for design in the PR.
 *
 * Relative imports only (node:test).
 */

import { fillWords, type WordFill } from "../replicate/words.ts";

export const M4_WORDS = {
  "m4.picker.title": "Render a package",
  "m4.picker.for": "{code} · {stage}",
  "m4.picker.rights": "Only material this show can use is offered: shareable files, and {client}’s own.",
  "m4.stage.signup": "Signup",
  "m4.stage.presale": "Presale",
  "m4.stage.on_sale": "On sale",
  "m4.recipe.montage": "Montage (15 s)",
  "m4.recipe.roll_call": "Roll-call",
  "m4.recipe.top_tracks": "Top tracks",
  "m4.recipe.artist_card": "Artist card",
  "m4.recipe.montage.what": "16 clips cut to the drop, with the date, venue and lineup landing on the kicks.",
  "m4.recipe.roll_call.what": "One raw clip under the show’s overlay, with the sold-out roll-call.",
  "m4.recipe.top_tracks.what": "The press shot, then three tracks to their drops, ending on the story artwork.",
  "m4.recipe.artist_card.what": "The press shot with name, date and venue, over the best-known tracks.",
  "m4.recipe.later": "Coming after the montage",
  "m4.owner.label": "Owner",
  "m4.owner.artist": "{artist}",
  "m4.owner.promoter": "{client}",
  "m4.owner.offpixel": "Off/Pixel, from {artist}’s material",
  "m4.owner.pending": "Set by the clips you pick",
  "m4.needs": "Needs",
  "m4.need.clips": "{m} clips",
  "m4.need.raw_clip": "1 raw 9:16 clip, about 15 s",
  "m4.need.track": "Track and drop",
  "m4.need.tracks": "{m} tracks and their drops",
  "m4.need.tracks.one": "1 track and its drop",
  "m4.need.snippets": "{m} track snippets",
  "m4.need.snippets.one": "1 track snippet",
  "m4.need.lineup": "Lineup",
  "m4.need.kit": "Overlay kit",
  "m4.need.claim": "Claim",
  "m4.need.press_shot": "Press shot",
  "m4.need.artwork": "9:16 story artwork",
  "m4.need.details": "Name, date and venue",
  "m4.need.ready": "ready",
  "m4.need.count": "{n} of {m} picked",
  "m4.need.none": "not picked",
  "m4.need.missing": "missing",
  "m4.need.pick": "Pick",
  "m4.need.clips.mix": "{a} filmed by {client} · {b} {artist}’s",
  "m4.need.track.drop": "drop at {s} s",
  "m4.need.kit.name": "{client}’s kit",
  "m4.need.lineup.count": "{n} names, from the event",
  "m4.need.lineup.count.one": "1 name, from the event",
  "m4.need.claim.line": "{claim} · tiers read {date, time}",
  "m4.render": "Render {n} files",
  "m4.render.one": "Render 1 file",
  "m4.render.files": "{versions} × {ratios}",
  "m4.render.blocked": "Pick what’s missing first.",
  "m4.render.started": "Rendering {n} files. Each appears under Renders as it finishes.",
  "m4.render.started.one": "Rendering 1 file. It appears under Renders when it finishes.",
  "m4.rows.title": "Renders",
  "m4.row.meta": "{recipe} · {variant} · {cta} · {ratio} · round {round}",
  "m4.variant.no_text": "No text",
  "m4.variant.teaser": "Teaser",
  "m4.variant.announcement": "Announcement",
  "m4.cta.none": "No CTA",
  "m4.row.passed": "Passed every check and the {recipe} list",
  "m4.row.failed": "Failed: {checks}",
  "m4.row.rendering": "Rendering",
  "m4.row.render_failed": "Didn’t render, so there’s no file.",
  "m4.row.retry": "Try again",
  "m4.row.rerender": "Render as round {round}",
  "m4.row.drive": "Drive ↗",
  "m4.row.blocked": "Failed {checks}, so it can’t be uploaded.",
  "m4.check.voice": "Voice",
  "m4.check.style": "Style",
  "m4.check.stage": "Stage",
  "m4.check.audio": "Audio",
  "m4.check.open": "Top-tracks open",
  "m4.check.facts": "Facts",
  "m4.check.format": "Format",
  "m4.check.cta_naming_art": "CTA, naming and latest art",
  "m4.item.montage.clips": "Clips",
  "m4.item.montage.music": "Music and drop",
  "m4.item.montage.moments": "Hands-up and flashes",
  "m4.item.montage.text": "Text on the kicks",
  "m4.item.montage.versions": "Versions",
  "m4.item.roll_call.clip": "Clip",
  "m4.item.roll_call.overlay": "Overlay",
  "m4.item.roll_call.claim": "Claim",
  "m4.item.roll_call.versions": "Versions",
  "m4.item.top_tracks.open": "Press-shot open",
  "m4.item.top_tracks.cuts": "Track cuts",
  "m4.item.top_tracks.overlay": "Overlay and audio",
  "m4.item.top_tracks.end": "End card",
  "m4.item.artist_card.shot": "Press shot",
  "m4.item.artist_card.details": "Name, date and venue",
  "m4.item.artist_card.ratios": "Ratios",
  "m4.mcp.request": "Render package for {code} ({client}): {recipes}, {files}.",
  "m4.mcp.recipe": "{recipe}: {needs}.",
  "m4.mcp.missing": "Can’t render {recipe} yet for {code}: {needs} missing. Nothing was rendered.",
  "m4.mcp.done": "Done: {files} rendered for {code}.",
  "m4.mcp.passed": "{p} passed every check.",
  "m4.mcp.passed.one": "1 passed every check.",
  "m4.mcp.failed": "{f} failed: {checks}.",
  "m4.mcp.failed.one": "1 failed: {checks}.",
  "m4.mcp.file": "- {file name} · {result} · {badge} · {link}",
  "m4.mcp.file.passed": "passed",
  "m4.mcp.file.failed": "failed: {checks}",
  "m4.mcp.upload": "{p} passed and can be uploaded now. {f} failed and can’t be.",
  "m4.mcp.upload.all": "All {p} passed and can be uploaded now.",
  "today.mcp.action.render_package": "Render package",
  "today.mcp.change.render": "{recipes}: {files}",
  "today.mcp.count.files": "{n} files",
  "today.mcp.count.files.one": "1 file",
  "today.mcp.result.rendered": "Done · {files} rendered and filed in Drive · {p} passed every check",
  "today.mcp.result.rendered.failed": "{f} failed: {checks}",
  "today.mcp.result.rendered.failed.one": "1 failed: {checks}",
  "today.mcp.row.open_lab": "Open in the Lab",
  "today.mcp.row.refused.needs": "Refused · {recipe} is missing {needs}",
  "m4.mcp.started": "Rendering {files} for {code}. Each is filed in Drive as it finishes.",
  "m4.mcp.refused.no_approval": "Refused: there’s no approval with this. Ask Matas in chat, then send his exact question and answer with it. Nothing was rendered.",
  "m4.mcp.refused.cap": "Refused: this package is {n} files, over the {c}-file cap for one package. Nothing was rendered.",
  "m4.mcp.refused.promoter": "Refused: {n} of the picked clips were filmed by {client}, so they can’t go into a render for {show client}’s show. Nothing was rendered.",
  "m4.mcp.refused.promoter.one": "Refused: 1 of the picked clips was filmed by {client}, so it can’t go into a render for {show client}’s show. Nothing was rendered.",
  "m4.mcp.refused.voice": "Refused: the copy is in {artist}’s voice, and there’s no approved caption for it. Use an approved caption, or write it in the promoter’s voice. Nothing was rendered.",
  "today.mcp.row.rendering": "Rendering · {n} of {m} files done",
  "today.mcp.undo.render": "No Undo: rendered files stay in the event’s Drive folder.",
  "today.mcp.row.refused.cap": "Refused · over the {c}-file cap",
  "today.mcp.row.refused.promoter": "Refused · {client}’s footage in the picks",
  "today.mcp.row.refused.voice": "Refused · artist-voice copy with no approved caption",
} as const;

export const TODAY_WORDS = {
  "today.mcp.title": "Claude’s changes",
  "today.mcp.count.changes": "{n} today",
  "today.mcp.count.changes.one": "1 today",
  "today.mcp.row.title": "{action} · {code}",
  "today.mcp.row.approved_in_claude": "Approved in Claude · {date, time}",
  "today.mcp.row.asked": "What Claude asked",
  "today.mcp.row.asked.q": "Asked: “{asked}”",
  "today.mcp.row.asked.a": "Answer: “{answer}”",
  "today.mcp.row.refused.no_approval": "Refused · no approval given",
} as const;

export type M4Key = keyof typeof M4_WORDS;
export type TodayKey = keyof typeof TODAY_WORDS;

/** One M4 row, filled. */
export function m4(key: M4Key, values: WordFill = {}): string {
  return fillWords(M4_WORDS[key], values);
}

/** One TD row, filled. */
export function today(key: TodayKey, values: WordFill = {}): string {
  return fillWords(TODAY_WORDS[key], values);
}

/**
 * Builder's candidates for Claude-facing lines no record has (RY3 asks every
 * refusal to end "Nothing was rendered."). PENDING DESIGN: listed in the PR;
 * none is shown on a screen.
 */
export const CLAUDE_CANDIDATES = {
  /** One package at a time per event (cost guard). */
  busy: "Refused: a package is already rendering for {code}. Wait for it to finish. Nothing was rendered.",
  /** The 60 s loop guard (cost guard). */
  tooSoon: "Refused: a {recipe} package for {code} started under a minute ago. Nothing was rendered.",
  /** The grant has no mcp:render, or the user isn't Matas. */
  notRender: "This connection can't render. Only Matas's connection can, after he reconnects Off/Pixel in Claude. Nothing was rendered.",
  /** No event with that code, or an archived client's. */
  noEvent: "No event with code {code}. Nothing was rendered.",
  /** A recipe that isn't built yet. */
  notBuilt: "{recipe} isn't built yet: only the montage renders. Nothing was rendered.",
  /** asked or answer over 1,000 characters (M3a's limit). */
  approvalTooLong: "asked and answer are at most 1000 characters each. Nothing was rendered.",
  /** get_render_package with no package on the event. */
  noPackage: "No render package for {code} yet.",
} as const;

export function candidate(key: keyof typeof CLAUDE_CANDIDATES, values: WordFill = {}): string {
  return fillWords(CLAUDE_CANDIDATES[key], values);
}

/** {files}: "9 files" / "1 file" (today.mcp.count.files). */
export function filesWord(n: number): string {
  return n === 1 ? m4("today.mcp.count.files.one") : m4("today.mcp.count.files", { n });
}

export const RECIPES = ["montage", "roll-call", "top-tracks", "artist-card"] as const;
export type Recipe = (typeof RECIPES)[number];

/** {recipe} for each recipe (m4.recipe.*). */
export function recipeWord(recipe: Recipe): string {
  if (recipe === "montage") return m4("m4.recipe.montage");
  if (recipe === "roll-call") return m4("m4.recipe.roll_call");
  if (recipe === "top-tracks") return m4("m4.recipe.top_tracks");
  return m4("m4.recipe.artist_card");
}

/** A list of recipes as the frames write it: "Montage (15 s), roll-call, top tracks, artist card". */
export function recipesWord(recipes: readonly Recipe[]): string {
  return recipes.map((r, i) => (i === 0 ? recipeWord(r) : recipeWord(r).toLowerCase())).join(", ");
}

export type Stage = "signup" | "presale" | "on_sale";

export function stageWord(stage: Stage): string {
  return m4(stage === "signup" ? "m4.stage.signup" : stage === "presale" ? "m4.stage.presale" : "m4.stage.on_sale");
}

/** The check names (m4.check.*), keyed as the checks module keys them. */
export const CHECK_WORDS = {
  voice: M4_WORDS["m4.check.voice"],
  style: M4_WORDS["m4.check.style"],
  stage: M4_WORDS["m4.check.stage"],
  audio: M4_WORDS["m4.check.audio"],
  open: M4_WORDS["m4.check.open"],
  facts: M4_WORDS["m4.check.facts"],
  format: M4_WORDS["m4.check.format"],
  cta_naming_art: M4_WORDS["m4.check.cta_naming_art"],
  "montage.clips": M4_WORDS["m4.item.montage.clips"],
  "montage.music": M4_WORDS["m4.item.montage.music"],
  "montage.moments": M4_WORDS["m4.item.montage.moments"],
  "montage.text": M4_WORDS["m4.item.montage.text"],
  "montage.versions": M4_WORDS["m4.item.montage.versions"],
} as const;
export type CheckKey = keyof typeof CHECK_WORDS;

/** "{checks}": names joined with " · " (m4.row.failed's note). */
export function checksWord(keys: readonly CheckKey[]): string {
  return keys.map((k) => CHECK_WORDS[k]).join(" · ");
}
