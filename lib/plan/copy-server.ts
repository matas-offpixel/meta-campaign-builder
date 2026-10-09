/**
 * Suggest and Apply for MML ③.
 *
 * Suggest fetches the page (or reports why it could not) and asks
 * `MML_COPY_MODEL` (`claude-haiku-4-5`, the asset-queue copy model) with
 * `ANTHROPIC_API_KEY`. Apply writes only MML-owned creatives and re-stamps
 * the send fingerprint. A missing migration 194 does not block the request;
 * the row is written when the table exists.
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  applyGoogleChannelDefaults,
  loadChannelDefaultsForEvent,
  resolveChannelDefaults,
} from "../clients/channel-defaults.ts";
import { createGoogleSearchPlanTreeFromDraft, loadGoogleSearchPlanTree, saveGoogleSearchPlanTree } from "../db/google-search-plans.ts";
import { upsertTikTokDraft } from "../db/tiktok-drafts.ts";
import { planToGoogleDraft } from "./adapters/google.ts";
import { creativeDraftFingerprint } from "./creative-intake-apply.ts";
import { listIntakeGroups, stampIntakeGroup } from "./creative-intake-db.ts";
import {
  applyCopy,
  applyCopyToGoogleTree,
  GOOGLE_COPY_PUSHED_NOTE,
  type CopyAcross,
  type CopySelection,
} from "./copy-apply.ts";
import { type CopyEventFacts, factCorpus, unsupportedFact } from "./copy-facts.ts";
import { fetchEventPage } from "./copy-fetch.ts";
import { corpusFor, scrapeHtml, type ScrapedPage } from "./copy-scrape.ts";
import { buildSuggestions, keywordsFromEvent, MML_COPY_MODEL, suggestPrompt, type BuiltSuggestions } from "./copy-suggest.ts";
import { deriveGoogleKeywords, deriveGoogleNoiseNegatives, mergeDerivedGoogleKeywords, toGoogleSearchPlanDraftTree } from "./derive/google.ts";
import { buildPlanVocabulary } from "./derive/server.ts";
import { loadLinkedDraftsForPlan, upsertLinkedMetaDraft } from "./linked-drafts.ts";
import { GOOGLE_PREPARE_REASON } from "./prepare-draft.ts";
import { upsertPlanLaunchRow } from "./persist.ts";
import type { CampaignPlan } from "./types.ts";
import type { CTAType } from "../types.ts";

const EMPTY_EVENT: CopyEventFacts = {
  name: "",
  artist: "",
  venue: "",
  city: "",
  date: "",
  ticketDate: "",
  saleDate: "",
  price: "",
  capacity: "",
  clientName: "",
};

function day(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  return value.slice(0, 10);
}

export async function loadCopyEvent(supabase: unknown, eventId: string | null): Promise<CopyEventFacts> {
  if (!eventId) return EMPTY_EVENT;
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
          limit: (n: number) => Promise<{ data: Array<Record<string, unknown>> | null }>;
        };
      };
    };
  };
  const { data: event } = await client
    .from("events")
    .select("name, venue_name, venue_city, event_date, presale_at, general_sale_at, ticket_price, capacity, client_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return EMPTY_EVENT;
  const clientId = typeof event.client_id === "string" ? event.client_id : "";
  const [{ data: clientRow }, { data: artists }] = await Promise.all([
    clientId
      ? client.from("clients").select("name").eq("id", clientId).maybeSingle()
      : Promise.resolve({ data: null }),
    client
      .from("event_artists")
      .select("artists(name)")
      .eq("event_id", eventId)
      .limit(5),
  ]);
  const artistNames = (artists ?? [])
    .map((row) => {
      const nested = row.artists as { name?: string } | Array<{ name?: string }> | null;
      if (Array.isArray(nested)) return nested.map((item) => item.name ?? "").filter(Boolean).join(", ");
      return nested?.name ?? "";
    })
    .filter(Boolean);
  return {
    name: typeof event.name === "string" ? event.name : "",
    artist: artistNames.join(", "),
    venue: typeof event.venue_name === "string" ? event.venue_name : "",
    city: typeof event.venue_city === "string" ? event.venue_city : "",
    date: day(event.event_date),
    ticketDate: day(event.presale_at),
    saleDate: day(event.general_sale_at),
    price: event.ticket_price == null ? "" : String(event.ticket_price),
    capacity: event.capacity == null ? "" : String(event.capacity),
    clientName: typeof clientRow?.name === "string" ? clientRow.name : "",
  };
}

async function saveCopyRow(
  supabase: unknown,
  input: {
    planId: string;
    userId: string;
    sourceUrl: string;
    fetchError: string | null;
    pageText: string;
    suggestions: BuiltSuggestions["suggestions"];
    selected: string[];
  },
): Promise<void> {
  const client = supabase as {
    from: (table: string) => {
      upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: { message?: string } | null }>;
    };
  };
  await client.from("campaign_plan_copy").upsert(
    {
      plan_id: input.planId,
      user_id: input.userId,
      source_url: input.sourceUrl,
      fetch_error: input.fetchError,
      page_text: input.pageText.slice(0, 8000),
      suggestions: input.suggestions,
      selected_ids: input.selected,
      model: MML_COPY_MODEL,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "plan_id" },
  );
}

export async function suggestPlanCopy(
  supabase: unknown,
  plan: CampaignPlan,
  url: string,
): Promise<{
  suggestions: BuiltSuggestions["suggestions"];
  droppedLine: string;
  fetchError: string | null;
  pageText: string;
  model: string;
}> {
  const event = await loadCopyEvent(supabase, plan.intent.eventId);
  const target = url.trim() || plan.intent.destinationUrl.trim();
  let page: ScrapedPage | null = null;
  let fetchError: string | null = null;
  if (target) {
    const fetched = await fetchEventPage(target);
    if (fetched.ok) page = scrapeHtml(fetched.html);
    else fetchError = fetched.reason;
  } else {
    fetchError = "No URL";
  }
  const corpus = corpusFor(page, event);
  let raw = "";
  if (!process.env.ANTHROPIC_API_KEY) {
    fetchError = [fetchError, "ANTHROPIC_API_KEY is not set"].filter(Boolean).join(". ");
  } else {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: MML_COPY_MODEL,
      max_tokens: 1200,
      messages: [{ role: "user", content: suggestPrompt(event, page, fetchError) }],
    });
    raw = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
  }
  const built = buildSuggestions(raw, corpus);
  await saveCopyRow(supabase, {
    planId: plan.id,
    userId: plan.userId,
    sourceUrl: target,
    fetchError,
    pageText: page?.text ?? "",
    suggestions: built.suggestions,
    selected: [],
  });
  return {
    suggestions: built.suggestions,
    droppedLine: built.droppedLine,
    fetchError,
    pageText: page?.text ?? "",
    model: MML_COPY_MODEL,
  };
}

function checkedSelection(selection: CopySelection, corpus: string): { selection: CopySelection; droppedLine: string } {
  const dropped: string[] = [];
  const keep = (line: string) => {
    const reason = unsupportedFact(line, corpus);
    if (reason) {
      dropped.push(reason);
      return "";
    }
    return line;
  };
  const next: CopySelection = {
    ...selection,
    metaPrimary: selection.metaPrimary.map(keep).filter(Boolean),
    metaHeadline: keep(selection.metaHeadline),
    metaDescription: keep(selection.metaDescription),
    tiktok: keep(selection.tiktok),
    googleHeadlines: selection.googleHeadlines.map(keep).filter(Boolean),
    googleDescriptions: selection.googleDescriptions.map(keep).filter(Boolean),
  };
  const unique = [...new Set(dropped)];
  return {
    selection: next,
    droppedLine: dropped.length === 0 ? "" : `dropped ${dropped.length}: unsupported fact — ${unique.join("; ")}`,
  };
}

const CTAS = new Set<CTAType>(["sign_up", "learn_more", "book_now", "buy_tickets"]);

export async function applyPlanCopy(
  supabase: unknown,
  plan: CampaignPlan,
  input: { selection: CopySelection; across: CopyAcross; pageText: string },
): Promise<{ ok: true; notes: string[] } | { ok: false; error: string }> {
  const event = await loadCopyEvent(supabase, plan.intent.eventId);
  const corpus = factCorpus(input.pageText.slice(0, 8000), event);
  const checked = checkedSelection(
    { ...input.selection, cta: CTAS.has(input.selection.cta) ? input.selection.cta : "book_now" },
    corpus,
  );
  const drafts = await loadLinkedDraftsForPlan(supabase, plan);
  const groups = await listIntakeGroups(supabase, plan.id, plan.userId);
  const notes = checked.droppedLine ? [checked.droppedLine] : [];
  const owned = groups.ok
    ? groups.groups
        .filter((group) => group.metaCreativeId)
        .map((group) => {
          const creative = drafts.meta?.creatives.find((row) => row.id === group.metaCreativeId);
          return {
            key: group.stableKey,
            creativeId: group.metaCreativeId as string,
            fingerprint: group.sentFingerprint,
            draftFingerprint: creative ? creativeDraftFingerprint(creative) : null,
          };
        })
    : [];
  if (!drafts.meta) notes.push("No Meta draft — copy was not written there.");
  if (!drafts.tiktok) notes.push("No TikTok draft — copy was not written there.");
  const applied = applyCopy({
    meta: drafts.meta,
    tiktok: drafts.tiktok,
    owned,
    selection: checked.selection,
    across: input.across,
    metaLaunched: plan.launches.meta.status === "live" || Boolean(plan.launches.meta.platformCampaignId),
    tiktokLaunched: plan.launches.tiktok.status === "live" || Boolean(plan.launches.tiktok.platformCampaignId),
  });
  notes.push(...applied.notes);
  if (applied.meta && applied.metaChanged) {
    const saved = await upsertLinkedMetaDraft(supabase, applied.meta, plan.userId);
    if (!saved.ok) return { ok: false, error: saved.error };
    for (const [index, stamped] of applied.fingerprints.entries()) {
      await stampIntakeGroup(supabase, {
        planId: plan.id,
        userId: plan.userId,
        stableKey: stamped.key,
        metaCreativeId: stamped.creativeId,
        fingerprint: stamped.fingerprint,
        position: index,
      });
    }
  }
  if (applied.tiktok && applied.tiktokChanged) {
    await upsertTikTokDraft(supabase as never, applied.tiktok.id, { ...applied.tiktok, userId: plan.userId });
  }
  notes.push(...(await applyGoogle(supabase, plan, checked.selection, event)));
  await saveCopyRow(supabase, {
    planId: plan.id,
    userId: plan.userId,
    sourceUrl: input.selection.url || plan.intent.destinationUrl,
    fetchError: null,
    pageText: input.pageText,
    suggestions: {
      metaPrimary: checked.selection.metaPrimary,
      metaHeadlines: checked.selection.metaHeadline ? [checked.selection.metaHeadline] : [],
      metaDescriptions: checked.selection.metaDescription ? [checked.selection.metaDescription] : [],
      tiktok: checked.selection.tiktok ? [checked.selection.tiktok] : [],
      googleHeadlines: checked.selection.googleHeadlines,
      googleDescriptions: checked.selection.googleDescriptions,
    },
    selected: checked.selection.metaPrimary,
  });
  return { ok: true, notes };
}

async function applyGoogle(
  supabase: unknown,
  plan: CampaignPlan,
  selection: CopySelection,
  event: CopyEventFacts,
): Promise<string[]> {
  const notes: string[] = [];
  const keywords = keywordsFromEvent(event);
  let draftId = plan.launches.google.draftId;
  try {
  if (!draftId) {
    if (!plan.launches.meta.draftId) {
      notes.push(GOOGLE_PREPARE_REASON);
      return notes;
    }
    const { vocabulary } = await buildPlanVocabulary(supabase, plan);
    const loaded = await loadChannelDefaultsForEvent(supabase, plan.intent.eventId);
    const resolved = resolveChannelDefaults(loaded?.stored ?? null, loaded?.overrides ?? {});
    const seeded = mergeDerivedGoogleKeywords(
      applyGoogleChannelDefaults(planToGoogleDraft(plan), resolved),
      deriveGoogleKeywords(vocabulary),
      deriveGoogleNoiseNegatives(),
    );
    const created = await createGoogleSearchPlanTreeFromDraft(
      supabase as never,
      plan.userId,
      toGoogleSearchPlanDraftTree(seeded.tree),
      { event_id: plan.intent.eventId },
    );
    draftId = created.plan_id;
    const launchWrite = await upsertPlanLaunchRow(supabase, {
      planId: plan.id,
      userId: plan.userId,
      adapter: "google",
      record: { ...plan.launches.google, draftId },
    });
    if (!launchWrite.ok) notes.push(launchWrite.error);
  }
  if (!draftId) return notes;
  const tree = await loadGoogleSearchPlanTree(supabase as never, draftId);
  if (!tree) {
    notes.push("Google Search plan was not found.");
    return notes;
  }
  const written = applyCopyToGoogleTree(tree, {
    headlines: selection.googleHeadlines,
    descriptions: selection.googleDescriptions,
    keywords,
  });
  if (written.note === GOOGLE_COPY_PUSHED_NOTE) {
    notes.push(written.note);
    return notes;
  }
  if (written.changed) await saveGoogleSearchPlanTree(supabase as never, written.tree);
  return notes;
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Google copy was not written");
    return notes;
  }
}
