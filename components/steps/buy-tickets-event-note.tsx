import {
  BUY_TICKETS_FACEBOOK_EVENT_WARNING,
  creativeBuyTicketsShowsAsFacebookEvent,
} from "@/lib/meta/creative";
import type { AdCreativeDraft } from "@/lib/types";

import { StatusLine } from "./step-surface";

export function BuyTicketsEventNote({ creative }: { creative: AdCreativeDraft }) {
  if (!creativeBuyTicketsShowsAsFacebookEvent(creative)) return null;
  return (
    <StatusLine className="mt-1 text-xs text-amber-600 dark:text-amber-400">
      {BUY_TICKETS_FACEBOOK_EVENT_WARNING}
    </StatusLine>
  );
}
