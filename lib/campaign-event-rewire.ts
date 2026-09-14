/**
 * Resolve a campaignCode / [CODE] mismatch into a single operator action.
 * Never applied on render — the button is the consent.
 */

import {
  codesDisagree,
  describeCodeEventMismatch,
  formatWiredEventLabel,
  isReplaceableEventCodePrefix,
  type CampaignEventIdentity,
} from "./campaign-event.ts";
import { parseBracketedEventCode } from "./insights/meta-event-code-match.ts";

export type WiringRewire = {
  kind: "rewire";
  code: string;
  event: CampaignEventIdentity;
  buttonLabel: string;
  fromLabel: string;
  toLabel: string;
};

export type WiringStamp = {
  kind: "stamp_event";
  code: string;
  event: CampaignEventIdentity;
  buttonLabel: string;
  fromLabel: string;
  toLabel: string;
};

export type WiringAmbiguous = {
  kind: "ambiguous";
  code: string;
  reason: string;
};

export type WiringResolution = WiringRewire | WiringStamp | WiringAmbiguous;

export function campaignCodeSide(
  campaignCode: string | null | undefined,
  campaignName: string | null | undefined,
): string | null {
  const code = (campaignCode ?? "").trim();
  const prefix = campaignName ? parseBracketedEventCode(campaignName) : null;
  return code || prefix || null;
}

function normCode(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/[\u2013\u2014\u2212]/g, "-");
}

function eventsWithCode(
  events: CampaignEventIdentity[],
  code: string,
): CampaignEventIdentity[] {
  return events.filter((event) => {
    const eventCode = (event.event_code ?? "").trim();
    if (!eventCode) return false;
    return !codesDisagree(eventCode, code);
  });
}

function unusableCodeReason(code: string): string | null {
  const trimmed = code.trim();
  if (/^\d{4}$/.test(trimmed)) {
    return `code ${trimmed} is a year, not an event code`;
  }
  const parts = trimmed.split(/[-–—−]/);
  const codeLike = parts.filter((part) => /^[A-Za-z]{2,}\d{2,}$/.test(part));
  if (codeLike.length >= 2) {
    return `code ${trimmed} is a multi-code marker`;
  }
  if (!isReplaceableEventCodePrefix(trimmed)) {
    return `code ${trimmed} is not a single event code`;
  }
  return null;
}

export function resolveWiringMatch(input: {
  campaignCode: string | null | undefined;
  campaignName: string | null | undefined;
  wiredEvent: CampaignEventIdentity | null;
  clientEvents: CampaignEventIdentity[];
}): WiringResolution | null {
  const mismatch = describeCodeEventMismatch({
    campaignCode: input.campaignCode,
    campaignName: input.campaignName,
    event: input.wiredEvent,
  });
  if (!mismatch || !input.wiredEvent) return null;

  const code = campaignCodeSide(input.campaignCode, input.campaignName);
  if (!code) return null;

  const unusable = unusableCodeReason(code);
  if (unusable) {
    return { kind: "ambiguous", code, reason: unusable };
  }

  const matches = eventsWithCode(input.clientEvents, code);
  const fromLabel = formatWiredEventLabel(input.wiredEvent);
  const wiredCode = (input.wiredEvent.event_code ?? "").trim();

  if (matches.length === 1) {
    const target = matches[0]!;
    if (target.id === input.wiredEvent.id) {
      return {
        kind: "ambiguous",
        code,
        reason: `wired event already has code ${normCode(wiredCode) || code}`,
      };
    }
    return {
      kind: "rewire",
      code,
      event: target,
      buttonLabel: `Rewire to ${code}`,
      fromLabel,
      toLabel: formatWiredEventLabel(target),
    };
  }

  if (matches.length > 1) {
    const n = matches.length;
    return {
      kind: "ambiguous",
      code,
      reason: n === 2 ? `two events have code ${code}` : `${n} events have code ${code}`,
    };
  }

  if (!wiredCode) {
    return {
      kind: "stamp_event",
      code,
      event: input.wiredEvent,
      buttonLabel: `Set event code to ${code}`,
      fromLabel,
      toLabel: `event code ${code}`,
    };
  }

  return {
    kind: "ambiguous",
    code,
    reason: `no event has code ${code}`,
  };
}

export function canStampEvent(
  viewer: { userId: string; isOperator: boolean },
  eventOwnerUserId: string | null | undefined,
): boolean {
  return viewer.isOperator || eventOwnerUserId === viewer.userId;
}

export const REWIRE_PREVIEW_SENTENCE =
  "A rewire sets the draft's event, campaign code, [CODE] prefix, and event_id column. The loop stops skip_event_passed on the next tick if the new event is in the future; reporting rollups move the campaign; the creatives step offers the right ticket link. Nothing on Meta changes.";
