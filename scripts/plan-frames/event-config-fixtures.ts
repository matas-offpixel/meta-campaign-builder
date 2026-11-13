/**
 * Fixtures for the event page's Dashboard panel frames (D9, HD2). Ids match
 * scripts/plan-frames/event-config-shots.mjs.
 *
 *   EC1  a show with everything set: capacity 2,000 (no tier allocations),
 *        a CIRQLIN page, two reference shows and an alias.
 *   EC2  the umbrella with nothing set: "Set capacity on the event to see the
 *        sell-out line", "No CIRQLIN page", no reference shows, no aliases.
 *   EC3  a show whose sellable allocation comes from its paid tiers.
 */

import type { EventConfigPanelData, ReferenceOption } from "../../lib/event-config/panel.ts";
import { sellableAllocation } from "../../lib/event-config/allocation.ts";

export const EVENT_CONFIG_FRAME_IDS = ["EC1", "EC2", "EC3"] as const;
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

const others = (id: string) => NX.filter((o) => o.id !== id);

export const EVENT_CONFIG_FRAMES: Record<EventConfigFrameId, { eventId: string; data: EventConfigPanelData }> = {
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
        referenceEventIds: [],
        countAliases: ["D.O.D", "DOD"],
      },
      options: others("ev-dod"),
    },
  },
};
