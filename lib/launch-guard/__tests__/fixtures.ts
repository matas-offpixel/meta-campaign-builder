import { createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import type { AdCreativeDraft, AdSetSuggestion, CampaignDraft } from "../../types.ts";
import type { GuardEvent } from "../types.ts";
import { ELECTRIC_CLIENT_ID } from "../venue-defaults.ts";

/**
 * This week's Electric cases, from the production rows read on 24 Nov
 * (events, event_artists names reduced to the headliner). Ids are the
 * real event ids so the event-level pixel override map applies.
 */
export function electricEvent(partial: Partial<GuardEvent> & Pick<GuardEvent, "id" | "code">): GuardEvent {
  return {
    name: null,
    clientId: ELECTRIC_CLIENT_ID,
    venueName: null,
    venueKey: null,
    venueCity: null,
    signupUrl: null,
    ticketUrl: null,
    cirqlinPageSlug: null,
    metaAdAccountId: null,
    artists: [],
    ...partial,
  };
}

export const NX27_GLITTERBOX = electricEvent({
  id: "3b128276-4528-43b7-a102-9d165d14331b",
  code: "NX27-GLITTERBOX",
  name: "Glitterbox",
  venueName: "NX Newcastle",
  venueKey: "nx newcastle",
  signupUrl: "https://www.glitterbox-newcastle.com",
  metaAdAccountId: "606252931141334",
  artists: ["Glitterbox"],
});

export const EBR27_GLITTERBOX = electricEvent({
  id: "9361ce50-8a5f-4cbd-a7d9-67dc853fc212",
  code: "EBR27-GLITTERBOX",
  name: "Glitterbox",
  venueName: "Electric Bristol",
  venueKey: "electric bristol",
  signupUrl: "https://www.glitterbox-bristol.com",
  cirqlinPageSlug: "glitterbox-bristol",
  metaAdAccountId: "2011069725849568",
  artists: ["Glitterbox"],
});

export const NX27_PAULVANDYK = electricEvent({
  id: "407eb204-7498-49aa-983d-d336af81e871",
  code: "NX27-PAULVANDYK",
  name: "Paul van Dyk",
  venueName: "NX Newcastle",
  venueKey: "nx newcastle",
  signupUrl: "https://www.paulvandyk-newcastle.com",
  ticketUrl: "https://www.skiddle.com/whats-on/Newcastle-on-Tyne/NX-Newcastle/Paul-Van-Dyk/43195045",
  cirqlinPageSlug: "paulvandyk-newcastle",
  metaAdAccountId: "606252931141334",
  artists: ["Paul van Dyk"],
});

export const ES27_DAVEPEARCE = electricEvent({
  id: "2bb459a9-b2eb-4e00-a2ba-c5b8ddae7b55",
  code: "ES27-DAVEPEARCE",
  name: "Dave Pearce: Trance Anthems Day Party",
  venueName: "Electric Studios",
  venueKey: "electric studios",
  signupUrl: "https://crqln.com/l/davepearce-sheffield",
  ticketUrl:
    "https://www.skiddle.com/whats-on/Sheffield/Electric-Studios/Dave-Pearce-Trance-Anthems-Day-Party/43205515/",
  metaAdAccountId: "1073273492854557",
  artists: ["Dave Pearce"],
});

export const ES27_LPRHYTHM = electricEvent({
  id: "f319a1c7-29fb-47cd-a7dc-66fdd7356ee1",
  code: "ES27-LPRHYTHM",
  name: "L.P Rhythm",
  venueName: "Electric Studios",
  venueKey: "electric studios",
  signupUrl: "https://www.lprhythm-sheffield.com",
  cirqlinPageSlug: "lprhythm-sheffield",
  metaAdAccountId: "1073273492854557",
  artists: ["L.P Rhythm"],
});

export const ALL_EVENTS = [NX27_GLITTERBOX, EBR27_GLITTERBOX, NX27_PAULVANDYK, ES27_DAVEPEARCE, ES27_LPRHYTHM];

export function othersThan(event: GuardEvent): GuardEvent[] {
  return ALL_EVENTS.filter((other) => other.id !== event.id);
}

export function creative(partial: Partial<AdCreativeDraft> & { name: string }): AdCreativeDraft {
  return { ...createDefaultCreative("registration"), ...partial };
}

function adSet(name: string): AdSetSuggestion {
  return { id: name, name, sourceType: "blank", sourceId: "", sourceName: name, enabled: true } as AdSetSuggestion;
}

/** A clean NX27-GLITTERBOX signup draft: NX account and pixel, the Newcastle page. */
export function glitterboxNxDraft(): CampaignDraft {
  const base = createDefaultDraft();
  return {
    ...base,
    settings: {
      ...base.settings,
      clientId: ELECTRIC_CLIENT_ID,
      eventId: NX27_GLITTERBOX.id,
      campaignCode: "NX27-GLITTERBOX",
      campaignName: "[NX27-GLITTERBOX] SIGNUP",
      metaAdAccountId: "act_606252931141334",
      adAccountId: "act_606252931141334",
      metaPixelId: "645185673672763",
      wizardMode: "new",
    },
    creatives: ["Static 1", "Static 2", "Video 1"].map((name) =>
      creative({
        name,
        destinationUrl: "https://www.glitterbox-newcastle.com",
        headline: "Glitterbox · NX Newcastle",
        captions: [{ id: `${name}-c`, text: "Glitterbox comes to NX Newcastle. Sign up for ticket access." }],
      }),
    ),
    adSetSuggestions: ["Adv+ Broad", "Retargeting · signups", "Similar pages"].map(adSet),
  };
}
