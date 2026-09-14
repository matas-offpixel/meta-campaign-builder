import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyEventToCampaignSettings,
  type CampaignEventIdentity,
} from "../campaign-event.ts";
import { resolveWiringMatch } from "../campaign-event-rewire.ts";
import { createDefaultDraft } from "../campaign-defaults.ts";

const MALL_GRAB: CampaignEventIdentity = {
  id: "event-mallgrab",
  event_code: "ES26-MALLGRAB",
  client_id: "client-es",
  name: "Mall Grab",
  venue_city: "Sheffield",
  event_date: "2026-09-04",
};

const AZYR: CampaignEventIdentity = {
  id: "event-azyr",
  event_code: "NX26-AZYR",
  client_id: "client-nx",
  name: "AZYR",
  venue_city: "Newcastle",
  event_date: "2026-09-18",
};

const COLYN: CampaignEventIdentity = {
  id: "event-colyn",
  event_code: null,
  client_id: "client-louder",
  name: "Colyn",
  venue_city: "London",
  event_date: "2026-10-30",
};

const WORAKLS: CampaignEventIdentity = {
  id: "event-worakls",
  event_code: null,
  client_id: "client-louder",
  name: "Worakls",
  venue_city: "London",
  event_date: "2026-12-04",
};

const IRW0001_A: CampaignEventIdentity = {
  id: "event-irw-a",
  event_code: "IRW0001",
  client_id: "client-irw",
  name: "Jamie Jones A",
};

const IRW0001_B: CampaignEventIdentity = {
  id: "event-irw-b",
  event_code: "IRW0001",
  client_id: "client-irw",
  name: "Jamie Jones B",
};

const BRIDGE: CampaignEventIdentity = {
  id: "event-bridge",
  event_code: "UTB0044",
  client_id: "client-utb",
  name: "The Bridge",
  venue_city: "London",
  event_date: "2027-01-01",
};

describe("resolveWiringMatch", () => {
  it("[NX26-AZYR] resolves to rewire the Mall Grab draft onto NX26-AZYR", () => {
    const resolved = resolveWiringMatch({
      campaignCode: "NX26-AZYR",
      campaignName: "[NX26-AZYR] Azyr b2b PB69 - Signup",
      wiredEvent: MALL_GRAB,
      clientEvents: [MALL_GRAB, AZYR],
    });
    assert.equal(resolved?.kind, "rewire");
    if (resolved?.kind !== "rewire") return;
    assert.equal(resolved.event.id, AZYR.id);
    assert.equal(resolved.buttonLabel, "Rewire to NX26-AZYR");
    const next = applyEventToCampaignSettings(
      {
        ...createDefaultDraft().settings,
        eventId: MALL_GRAB.id,
        campaignCode: "NX26-AZYR",
        campaignName: "[NX26-AZYR] Azyr b2b PB69 - Signup",
      },
      resolved.event,
    );
    assert.equal(next.eventId, AZYR.id);
    assert.equal(next.campaignCode, "NX26-AZYR");
    assert.equal(next.campaignName, "[NX26-AZYR] Azyr b2b PB69 - Signup");
  });

  it("[20261003CS] Colyn resolves to stamp_event", () => {
    const resolved = resolveWiringMatch({
      campaignCode: "20261003CS",
      campaignName: "[20261003CS] Colyn —Purchase",
      wiredEvent: COLYN,
      clientEvents: [COLYN, WORAKLS],
    });
    assert.equal(resolved?.kind, "stamp_event");
    if (resolved?.kind !== "stamp_event") return;
    assert.equal(resolved.event.id, COLYN.id);
    assert.equal(resolved.code, "20261003CS");
    assert.equal(resolved.buttonLabel, "Set event code to 20261003CS");
  });

  it("[NX25-DJ EZ] with code OP1-DJEZ is ambiguous when no event has that code", () => {
    const resolved = resolveWiringMatch({
      campaignCode: "OP1-DJEZ",
      campaignName: "[NX25-DJ EZ] DJ EZ - NEWCASTLE - Purchase",
      wiredEvent: MALL_GRAB,
      clientEvents: [MALL_GRAB, AZYR],
    });
    assert.equal(resolved?.kind, "ambiguous");
    if (resolved?.kind !== "ambiguous") return;
    assert.match(resolved.reason, /no event has code OP1-DJEZ/);
  });

  it("[2027] The Bridge is ambiguous, never rewire", () => {
    const resolved = resolveWiringMatch({
      campaignCode: "2027",
      campaignName: "[2027] The Bridge - 2027 signup",
      wiredEvent: BRIDGE,
      clientEvents: [BRIDGE],
    });
    assert.equal(resolved?.kind, "ambiguous");
    if (resolved?.kind !== "ambiguous") return;
    assert.match(resolved.reason, /year/);
    assert.notEqual(resolved.kind, "rewire");
  });

  it("two events with the same code are ambiguous", () => {
    const resolved = resolveWiringMatch({
      campaignCode: "IRW0001",
      campaignName: "[IRW0001] Jamie Jones - Signups",
      wiredEvent: { ...COLYN, client_id: "client-irw" },
      clientEvents: [IRW0001_A, IRW0001_B],
    });
    assert.equal(resolved?.kind, "ambiguous");
    if (resolved?.kind !== "ambiguous") return;
    assert.match(resolved.reason, /two events have code IRW0001/);
  });

  it("a draft that already agrees has no resolution", () => {
    assert.equal(
      resolveWiringMatch({
        campaignCode: "NX26-AZYR",
        campaignName: "[NX26-AZYR] Registration",
        wiredEvent: AZYR,
        clientEvents: [AZYR, MALL_GRAB],
      }),
      null,
    );
  });
});
