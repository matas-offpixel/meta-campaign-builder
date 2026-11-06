/**
 * Creative Lab card on the event page. Reads only. Writes go through
 * lib/creative-lab/card-write.ts.
 */

import { profile } from "../../src/remotion/caption-style/profile.ts";
import { validateCaption, type EventFacts } from "../creative-lab/caption-facts.ts";
import { labLaunchesEnabled } from "../creative-lab/killswitch.ts";
import type { ServiceRoleDb } from "../creative-lab/load.ts";
import { daysUntilEvent, nextPayday } from "../creative-lab/payday.ts";
import { isCaptionStyle } from "../creative-lab/tags.ts";

type Row = Record<string, unknown>;

async function rows(db: ServiceRoleDb, table: string, column: string, value: string): Promise<Row[]> {
  const res = await db.from(table).select("*").eq(column, value);
  if (res.error) throw new Error(`${table}: ${res.error.message}`);
  return (res.data ?? []) as Row[];
}

function text(row: Row | undefined, key: string): string {
  return String(row?.[key] ?? "").trim();
}

export type RightsState = "missing" | "recorded" | "approved";

export function rightsState(artist: { rights_doc_ref?: string | null; approved_at?: string | null }): RightsState {
  if (artist.approved_at) return "approved";
  if (artist.rights_doc_ref?.trim()) return "recorded";
  return "missing";
}

export function rightsLabel(artist: { rights_doc_ref?: string | null; approved_at?: string | null }): string {
  const state = rightsState(artist);
  const ref = artist.rights_doc_ref?.trim();
  if (state === "approved") return ref ? `approved (${ref})` : "approved";
  if (state === "recorded") return `recorded, not approved${ref ? ` (${ref})` : ""}`;
  return "missing";
}

/** Headliners stay in the order given, and every name is on the lineup. */
export function headlinerError(lineup: readonly string[], headliners: readonly string[]): string | null {
  for (const name of headliners) {
    if (!lineup.includes(name)) return `${name} is not on the lineup`;
  }
  return null;
}

export type CreativeLabCardData = {
  eventId: string;
  eventStatus: string | null;
  launchesEnabled: boolean;
  longApproved: boolean;
  paydayLabel: string;
  daysToEvent: number | null;
  facts: { lineup: string[]; headliners: string[]; allowedDates: string[] } | null;
  artists: {
    id: string;
    name: string;
    rightsDocRef: string | null;
    startingCaption: string | null;
    metaPageId: string | null;
    instagramActorId: string | null;
    rights: RightsState;
    rightsLabel: string;
  }[];
  clips: {
    id: string;
    artistId: string;
    clipNo: number;
    source: string;
    rightsRef: string;
    filmedEventId: string | null;
    durationSeconds: number | null;
    thumbnailUrl: string | null;
  }[];
  assets: { id: string; filename: string; durationSeconds: number | null; thumbnailUrl: string | null }[];
  clientEvents: { id: string; name: string; eventDate: string | null }[];
  captions: {
    id: string;
    style: string;
    status: string;
    lines: string[];
    primaryText: string;
    sizeVariant: string;
    validatorOk: boolean;
    validatorDetail: string;
    awaitingLong: boolean;
  }[];
  adSets: { metaAdSetId: string; adAccountId: string; name: string; status: string; adCount: number; cap: 50 }[];
  rounds: {
    id: string;
    roundNo: number;
    artistId: string;
    artistName: string;
    status: string;
    artistApproved: boolean;
    rendersPending: boolean;
    ads: { id: string; adName: string; role: string; launchState: string; thumbnailUrl: string | null; metaAdId: string | null; adsManagerUrl: string | null }[];
  }[];
};

export async function loadCreativeLabCard(
  db: ServiceRoleDb,
  args: {
    eventId: string;
    userId: string;
    clientId: string | null;
    eventName: string;
    eventDate: string | null;
    venueName: string | null;
    venueCity: string | null;
    eventStatus: string | null;
    now?: Date;
  },
): Promise<CreativeLabCardData> {
  const [factRows, artists, captions, rounds, adSets, launchedAds, assets, clientEvents] = await Promise.all([
    rows(db, "creative_lab_event_facts", "event_id", args.eventId),
    args.clientId ? rows(db, "creative_lab_artists", "client_id", args.clientId) : Promise.resolve([]),
    rows(db, "creative_lab_captions", "event_id", args.eventId),
    rows(db, "creative_lab_rounds", "event_id", args.eventId),
    rows(db, "launched_ad_sets", "event_id", args.eventId),
    rows(db, "launched_ads", "event_id", args.eventId),
    rows(db, "creative_assets", "user_id", args.userId),
    args.clientId ? rows(db, "events", "client_id", args.clientId) : Promise.resolve([]),
  ]);
  const artistIds = new Set(artists.map((row) => text(row, "id")));
  const clipRows = (await rows(db, "creative_lab_clips", "user_id", args.userId)).filter((row) => artistIds.has(text(row, "artist_id")));
  const roundIds = new Set(rounds.map((row) => text(row, "id")));
  const adRows = (await rows(db, "creative_lab_round_ads", "user_id", args.userId)).filter((row) => roundIds.has(text(row, "round_id")));
  const launchRows = (await rows(db, "creative_lab_round_ad_launches", "user_id", args.userId)).filter((row) =>
    adRows.some((ad) => text(ad, "id") === text(row, "round_ad_id")),
  );

  const factsRow = factRows[0];
  const lineup = ((factsRow?.lineup as string[] | undefined) ?? []).map((name) => name.trim()).filter(Boolean);
  const headliners = ((factsRow?.headliners as string[] | undefined) ?? []).map((name) => name.trim()).filter(Boolean);
  const allowedDates = ((factsRow?.allowed_dates as string[] | undefined) ?? []).map((day) => day.slice(0, 10));
  const facts: EventFacts | null = factsRow
    ? {
        eventId: args.eventId,
        eventName: args.eventName,
        eventDate: args.eventDate?.slice(0, 10) ?? null,
        venueName: args.venueName,
        venueCity: args.venueCity,
        lineup,
        headliners,
        hasFacts: true,
        allowedDates,
        tiers: [],
      }
    : null;

  const assetOf = new Map(assets.map((row) => [text(row, "id"), row]));
  const videos = assets.filter((row) => text(row, "media_kind") === "video");
  const counts = new Map<string, number>();
  for (const ad of launchedAds) {
    const id = text(ad, "meta_adset_id");
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return {
    eventId: args.eventId,
    eventStatus: args.eventStatus,
    launchesEnabled: labLaunchesEnabled(),
    longApproved: profile.longApproved,
    paydayLabel: nextPayday(args.now).label,
    daysToEvent: daysUntilEvent(args.eventDate, args.now),
    facts: factsRow ? { lineup, headliners, allowedDates } : null,
    artists: artists.map((row) => ({
      id: text(row, "id"),
      name: text(row, "name"),
      rightsDocRef: text(row, "rights_doc_ref") || null,
      startingCaption: text(row, "starting_caption") || null,
      metaPageId: text(row, "meta_page_id") || null,
      instagramActorId: text(row, "instagram_actor_id") || null,
      rights: rightsState({ rights_doc_ref: text(row, "rights_doc_ref"), approved_at: text(row, "approved_at") || null }),
      rightsLabel: rightsLabel({ rights_doc_ref: text(row, "rights_doc_ref"), approved_at: text(row, "approved_at") || null }),
    })),
    clips: clipRows.map((row) => {
      const asset = assetOf.get(text(row, "creative_asset_id"));
      const seconds = row.out_s == null ? (asset?.duration_seconds == null ? null : Number(asset.duration_seconds)) : Number(row.out_s);
      return {
        id: text(row, "id"),
        artistId: text(row, "artist_id"),
        clipNo: Number(row.clip_no),
        source: text(row, "source"),
        rightsRef: text(row, "rights_ref"),
        filmedEventId: text(row, "event_id") || null,
        durationSeconds: seconds,
        thumbnailUrl: text(asset, "thumbnail_url") || null,
      };
    }),
    assets: videos.map((row) => ({
      id: text(row, "id"),
      filename: text(row, "filename"),
      durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
      thumbnailUrl: text(row, "thumbnail_url") || null,
    })),
    clientEvents: clientEvents.map((row) => ({
      id: text(row, "id"),
      name: text(row, "name"),
      eventDate: text(row, "event_date").slice(0, 10) || null,
    })),
    captions: captions
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .map((row) => {
        const style = text(row, "style");
        const sizeVariant = text(row, "size_variant") || "default";
        const overlay = text(row, "text");
        const primary = text(row, "primary_text");
        const check = facts && isCaptionStyle(style)
          ? validateCaption(overlay, style, (row.declared_names as string[] | undefined) ?? [], facts, { version: text(row, "style_version") }, { primaryText: primary })
          : null;
        return {
          id: text(row, "id"),
          style,
          status: text(row, "status"),
          lines: check?.lines ?? (Array.isArray(row.lines) ? (row.lines as string[]) : [overlay]),
          primaryText: primary,
          sizeVariant,
          validatorOk: check?.ok ?? false,
          validatorDetail: check ? (check.ok ? "passed" : check.errors.map((error) => error.detail).join("; ")) : "no event facts",
          awaitingLong: sizeVariant === "long" && !profile.longApproved,
        };
      }),
    adSets: adSets.map((row) => ({
      metaAdSetId: text(row, "meta_adset_id"),
      adAccountId: text(row, "ad_account_id"),
      name: text(row, "source_name") || text(row, "meta_adset_id"),
      status: text(row, "phase_at_launch") || "recorded",
      adCount: counts.get(text(row, "meta_adset_id")) ?? 0,
      cap: 50 as const,
    })),
    rounds: rounds
      .sort((a, b) => Number(b.round_no) - Number(a.round_no))
      .map((round) => {
        const artist = artists.find((row) => text(row, "id") === text(round, "artist_id"));
        const ads = adRows.filter((row) => text(row, "round_id") === text(round, "id"));
        return {
          id: text(round, "id"),
          roundNo: Number(round.round_no),
          artistId: text(round, "artist_id"),
          artistName: text(artist, "name"),
          status: text(round, "status"),
          artistApproved: Boolean(artist?.approved_at),
          rendersPending: ads.some((ad) => text(ad, "launch_state") === "pending"),
          ads: ads.map((ad) => {
            const launch = launchRows.find((row) => text(row, "round_ad_id") === text(ad, "id"));
            const clip = clipRows.find((row) => text(row, "id") === text(ad, "clip_id"));
            const asset = assetOf.get(text(clip, "creative_asset_id"));
            const account = text(launch, "ad_account_id").replace(/^act_/, "");
            const metaAdId = text(launch, "meta_ad_id") || null;
            return {
              id: text(ad, "id"),
              adName: text(ad, "ad_name"),
              role: text(ad, "role"),
              launchState: text(ad, "launch_state"),
              thumbnailUrl: text(asset, "thumbnail_url") || null,
              metaAdId,
              adsManagerUrl: metaAdId && account
                ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${account}&selected_ad_ids=${metaAdId}`
                : null,
            };
          }),
        };
      }),
  };
}
