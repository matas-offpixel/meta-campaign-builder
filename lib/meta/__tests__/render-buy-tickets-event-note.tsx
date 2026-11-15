import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BuyTicketsEventNote } from "../../../components/steps/buy-tickets-event-note.tsx";
import { createDefaultCreative } from "../../campaign-defaults.ts";
import type { AdCreativeDraft, CTAType } from "../../types.ts";

function draft(cta: CTAType, assetMode: AdCreativeDraft["assetMode"]): AdCreativeDraft {
  return { ...createDefaultCreative(), cta, assetMode };
}

const render = (c: AdCreativeDraft) => renderToStaticMarkup(createElement(BuyTicketsEventNote, { creative: c }));

console.log(
  JSON.stringify({
    buyTicketsDual: render(draft("buy_tickets", "dual")),
    bookNowDual: render(draft("book_now", "dual")),
    buyTicketsSingle: render(draft("buy_tickets", "single")),
  }),
);
