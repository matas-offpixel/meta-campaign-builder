/**
 * Fixtures for the event page's Dashboard panel frames (D9, HD2). Ids match
 * scripts/plan-frames/event-config-shots.mjs.
 *
 *   EC1  a show with everything set: capacity 2,000 (no tier allocations),
 *        a resolved CIRQLIN page ("{page title} · crqln.com/{slug}"), two
 *        reference shows and an alias.
 *   EC2  the umbrella with nothing set: "Set capacity on the event to see the
 *        sell-out line", no reference shows, no aliases.
 *   EC3  a show whose sellable allocation comes from its paid tiers.
 *   EC4  a pasted link CIRQLIN can't resolve (404 no_page, here a draft):
 *        "That link isn't a live CIRQLIN page. Publish it first, or check
 *        the link." under the field, and nothing saved.
 *   EC5  a check that didn't happen (401 / 429 / 500 / network): "Couldn't
 *        check the link with CIRQLIN just now. Try again." Nothing saved.
 *   EC6  input that isn't a link: "Paste the page's link." CIRQLIN isn't
 *        called.
 *   EC7  a stored page whose ?id= refresh came back 404: "{stored title} ·
 *        not live now". The stored id and cache are kept.
 *
 * Reference shows are the finished shows only (canBeReferenceShow), on the
 * frames' fixed day, 13 Nov 2026.
 *
 * Page ids, titles and slugs are made up.
 */

import type { EventConfigPanelData, ReferenceOption } from "../../lib/event-config/panel.ts";
import { sellableAllocation } from "../../lib/event-config/allocation.ts";
import { CIRQLIN_PAGE_CHECK_FAILED, CIRQLIN_PAGE_NOT_A_LINK, CIRQLIN_PAGE_NOT_FOUND } from "../../lib/event-config/cirqlin.ts";
import { canBeReferenceShow } from "../../lib/event-config/form.ts";

export const EVENT_CONFIG_FRAME_IDS = ["EC1", "EC2", "EC3", "EC4", "EC5", "EC6", "EC7"] as const;

/** The frames' "today": shows before it are finished. */
export const EVENT_CONFIG_FRAME_TODAY = "2026-11-13";
export type EventConfigFrameId = (typeof EVENT_CONFIG_FRAME_IDS)[number];

const NX: ReferenceOption[] = [
  { id: "ev-julianfijma", name: "Julian Fijma", eventDate: "2027-03-19", isUmbrella: false },
  { id: "ev-ewanmcvicar", name: "Ewan McVicar", eventDate: "2027-02-26", isUmbrella: false },
  { id: "ev-schak", name: "Schak", eventDate: "2026-12-18", isUmbrella: false },
  { id: "ev-rudimental", name: "Rudimental", eventDate: "2026-12-12", isUmbrella: false },
  { id: "ev-locklead", name: "Locklead", eventDate: "2026-12-11", isUmbrella: false },
  { id: "ev-dod", name: "D.O.D", eventDate: "2026-12-04", isUmbrella: false },
  { id: "ev-global", name: "Global Marketing", eventDate: "2026-11-27", isUmbrella: true },
  { id: "ev-robbiedoherty", name: "Robbie Doherty", eventDate: "2026-11-27", isUmbrella: false },
  { id: "ev-ipc", name: "Interplanetary Criminal", eventDate: "2026-11-21", isUmbrella: false },
  { id: "ev-eed", name: "East End Dubs", eventDate: "2026-11-13", isUmbrella: false },
  { id: "ev-azyr", name: "AZYR b2b Partiboi69", eventDate: "2026-11-07", isUmbrella: false },
  { id: "ev-folamour", name: "Folamour", eventDate: "2026-10-23", isUmbrella: false },
  { id: "ev-mf", name: "Modern Funktion", eventDate: "2026-10-16", isUmbrella: false },
  { id: "ev-djez", name: "DJ EZ", eventDate: "2026-10-02", isUmbrella: false },
];

const others = (id: string) => NX.filter((o) => o.id !== id && canBeReferenceShow(o, EVENT_CONFIG_FRAME_TODAY));

export interface EventConfigFrame {
  eventId: string;
  data: EventConfigPanelData;
  /** A pasted link and the error the save returned for it. */
  initial?: { cirqlinPageLink: string; error: { message: string; field: "cirqlinPage" } };
}

export const EVENT_CONFIG_FRAMES: Record<EventConfigFrameId, EventConfigFrame> = {
  EC1: {
    eventId: "ev-ipc",
    data: {
      config: {
        eventId: "ev-ipc",
        clientId: "nx",
        capacity: 2000,
        sellable: sellableAllocation({ capacity: 2000, allocations: [] }),
        isUmbrella: false,
        cirqlinPageId: "5f3c2a10-8b7e-4d21-9c64-0e1a2b3c4d5e",
        cirqlinPage: {
          id: "5f3c2a10-8b7e-4d21-9c64-0e1a2b3c4d5e",
          title: "Interplanetary Criminal · Newcastle",
          slug: "ipc-newcastle-nov",
          checkedAt: "2026-11-13T18:00:00.000Z",
        },
        referenceEventIds: ["ev-mf", "ev-djez"],
        countAliases: ["IPC"],
      },
      options: others("ev-ipc"),
    },
  },
  EC2: {
    eventId: "ev-global",
    data: {
      config: {
        eventId: "ev-global",
        clientId: "nx",
        capacity: null,
        sellable: sellableAllocation({ capacity: null, allocations: [] }),
        isUmbrella: true,
        cirqlinPageId: null,
        cirqlinPage: null,
        referenceEventIds: [],
        countAliases: [],
      },
      options: others("ev-global"),
    },
  },
  EC3: {
    eventId: "ev-dod",
    data: {
      config: {
        eventId: "ev-dod",
        clientId: "nx",
        capacity: 2000,
        sellable: sellableAllocation({
          capacity: 2000,
          allocations: [
            { tier_name: "Early Bird", allocation_count: 250 },
            { tier_name: "Tier 1", allocation_count: 600 },
            { tier_name: "Tier 2", allocation_count: 600 },
            { tier_name: "Final Release", allocation_count: 400 },
            { tier_name: "Guest List", allocation_count: 150 },
          ],
        }),
        isUmbrella: false,
        cirqlinPageId: null,
        cirqlinPage: null,
        referenceEventIds: [],
        countAliases: ["D.O.D", "DOD"],
      },
      options: others("ev-dod"),
    },
  },
  EC4: {
    eventId: "ev-robbiedoherty",
    data: {
      config: {
        eventId: "ev-robbiedoherty",
        clientId: "nx",
        capacity: 2000,
        sellable: sellableAllocation({ capacity: 2000, allocations: [] }),
        isUmbrella: false,
        cirqlinPageId: null,
        cirqlinPage: null,
        referenceEventIds: [],
        countAliases: ["Robbie Doherty"],
      },
      options: others("ev-robbiedoherty"),
    },
    initial: {
      cirqlinPageLink: "crqln.com/robbie-doherty-draft",
      error: { message: CIRQLIN_PAGE_NOT_FOUND, field: "cirqlinPage" },
    },
  },
  EC5: {
    eventId: "ev-schak",
    data: {
      config: {
        eventId: "ev-schak",
        clientId: "nx",
        capacity: 2000,
        sellable: sellableAllocation({ capacity: 2000, allocations: [] }),
        isUmbrella: false,
        cirqlinPageId: null,
        cirqlinPage: null,
        referenceEventIds: [],
        countAliases: ["Schak"],
      },
      options: others("ev-schak"),
    },
    initial: {
      cirqlinPageLink: "crqln.com/schak-newcastle-dec",
      error: { message: CIRQLIN_PAGE_CHECK_FAILED, field: "cirqlinPage" },
    },
  },
  EC6: {
    eventId: "ev-locklead",
    data: {
      config: {
        eventId: "ev-locklead",
        clientId: "nx",
        capacity: 2000,
        sellable: sellableAllocation({ capacity: 2000, allocations: [] }),
        isUmbrella: false,
        cirqlinPageId: null,
        cirqlinPage: null,
        referenceEventIds: [],
        countAliases: ["Locklead"],
      },
      options: others("ev-locklead"),
    },
    initial: {
      cirqlinPageLink: "Locklead December",
      error: { message: CIRQLIN_PAGE_NOT_A_LINK, field: "cirqlinPage" },
    },
  },
  EC7: {
    eventId: "ev-eed",
    data: {
      config: {
        eventId: "ev-eed",
        clientId: "nx",
        capacity: 2000,
        sellable: sellableAllocation({ capacity: 2000, allocations: [] }),
        isUmbrella: false,
        cirqlinPageId: "8a1d4e2b-3c5f-4a6b-9d7e-1f2a3b4c5d6e",
        cirqlinPage: {
          id: "8a1d4e2b-3c5f-4a6b-9d7e-1f2a3b4c5d6e",
          title: "East End Dubs · Newcastle",
          slug: "eed-newcastle-nov",
          checkedAt: "2026-11-12T10:00:00.000Z",
          notLive: true,
        },
        referenceEventIds: [],
        countAliases: ["East End Dubs"],
      },
      options: others("ev-eed"),
    },
  },
};
