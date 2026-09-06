# Off/Pixel as WhatsApp API partner + in-chat ticketing checkout — strategic decision audit

**Date:** 2026-06-30 → 2026-07-01 (overnight strategic audit)
**Author:** Cursor (ops thread, Opus)
**Type:** Decision document. No production code. Research + financial modelling + competitive scan.
**Branch / PR:** `ops/wa-partner-strategy-audit` — draft PR, no auto-merge. Matas reviews AM.
**All web claims retrieved:** 2026-07-01 (BST). Every external claim carries a URL + this retrieval date. Where evidence is thin it is marked **UNVERIFIED**.

---

## 0. Reader's orientation — three things that reframe the whole brief

Before the phased analysis, three verified facts change the shape of the questions as originally posed. Read these first; the rest of the doc leans on them.

1. **"Conversation-based / conversation-tier pricing" no longer exists.** Meta moved the WhatsApp Business Platform to **per-message pricing on 1 July 2025**, and explicitly states *"Conversation-based pricing is deprecated."* ([Meta pricing docs](https://developers.facebook.com/docs/whatsapp/pricing/), retrieved 2026-07-01). So the brief's "charge clients per conversation-tier consumed" model must be restated as **per delivered template message, by category (Marketing / Utility / Authentication) and recipient country**. This matters for every cost line below.

2. **Off/Pixel is *already* a WhatsApp API operator today — through Bird.com (a BSP).** The D2C stack sends WhatsApp via Bird's Studio + channels API against real WABAs (Jackies, Throwback, etc.) — see `docs/audits/D2C_BIRD_TEMPLATES_API_AUDIT_2026-06-30.md` and `lib/d2c/bird/`. The strategic question is therefore **not** "should we access the WhatsApp API" (we do) but "should we **replace Bird with our own Meta Tech Provider integration** and take on the intermediary role ourselves." That is a much narrower, and much bigger-commitment, question.

3. **The "group creation bottleneck" is not solved by any partner tier.** The Groups API exists and is now open to all Official Business Accounts, but it is **capped at 8 participants per group** ([Meta Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups), retrieved 2026-07-01). Matas's chat-host business runs **large community groups** (hundreds+). No partner tier, and no current API, exposes programmatic creation of large WhatsApp **Communities/Groups**. This kills the strongest hoped-for synergy up front (detail in §10).

---

# PHASE 1 — META PARTNER PROGRAM LANDSCAPE

## 1. Program tiers as of mid-2026

Meta's own taxonomy has three partner types under "Solution Providers" ([Meta: Partners](https://developers.facebook.com/docs/whatsapp/solution-providers/), retrieved 2026-07-01):

### Solution Partner
- A **Meta Business Partner** that provides the full range of WhatsApp Business Platform services (messaging, **billing**, integration, support) to client businesses.
- **Gets a credit line from Meta** and can **invoice clients directly** for API usage.
- Has **Direct Support** and is eligible for the **Meta Business Partner SMB Accelerator Program** (incentives, accreditation, enablement, Solution Partner directory listing).
- Meta's own note: *"becoming a Solution Partner is a lengthy process, so if you don't need a credit line and don't need to invoice your clients for API usage directly, consider becoming a Tech Provider instead."*
- **Reality check:** this is the enterprise/BSP tier (Twilio, Infobip, 360dialog, Bird, etc.). It is not a realistic near-term target for a 2-person agency and Meta effectively steers small operators away from it.

### Tech Provider
- Can offer the **same full range** of services, either alone or jointly with a Solution Partner.
- **No credit line.** Clients onboarded by a Tech Provider **must add their own payment method and Meta bills the client directly** for API usage; the Tech Provider bills only for its own software/services ([Meta: Partners](https://developers.facebook.com/docs/whatsapp/solution-providers/), retrieved 2026-07-01).
- **Has Direct Support.** Cannot join the SMB Accelerator Program unless it upgrades to Tech Partner.
- **How you become one** ([Meta: Become a Tech Provider](https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers/), retrieved 2026-07-01):
  1. Create a Meta app with the **WhatsApp use case** connected to a business portfolio.
  2. **Verify your business** with Meta (skipped if already verified + linked).
  3. Pass **App Review** — submit app settings, **videos of your app**, and documentation, to obtain **Advanced access** to `whatsapp_business_messaging` (send on behalf of clients) and `whatsapp_business_management` (access clients' WABAs — without it, calls on WABAs you don't own fail with error `200`).
  4. Onboard clients via **Embedded Signup**.
- **No stated minimum message volume and no application fee to *become* a Tech Provider.** The gate is technical (build the integration, pass review), not commercial.

### Tech Partner
- A Tech Provider who is (or is eligible to become) a **Meta Business Partner**, unlocking the SMB Accelerate program and the Partner Portal.
- **Eligibility requirements** ([Meta: Upgrading to a Tech Partner](https://developers.facebook.com/docs/whatsapp/solution-providers/upgrade-to-tech-partner/), retrieved 2026-07-01):
  - Completed all Tech Provider steps.
  - **≥ 2,500 average daily messages** (sent or received) over the last 7 days, **or ≥ 200 average daily calls**.
  - **≥ 10 active clients** (each having sent ≥ 1 message via your app in the last 30 days).
  - Maintain a **phone number quality rating ≥ 90%**.
- **Reality check:** Off/Pixel with 5 clients cannot meet the 10-active-client bar today, and 2,500 msg/day is ~75k msg/month — plausible only at full multi-client scale. Tech Partner is a **year-2+ milestone**, not a starting point.

### WhatsApp Business Platform messaging tiers (separate from partner tier)
Since **7 October 2025** limits are **portfolio-based, not per-number**: all numbers in a business portfolio share the highest limit ([Bloomreach](https://documentation.bloomreach.com/engagement/docs/whatsapp-messaging-limits); [Chatarmin](https://chatarmin.com/en/blog/whats-app-messaging-limits), both retrieved 2026-07-01).

| Tier | Unique business-initiated recipients / 24h | Notes |
|---|---|---|
| Tier 0 | 250 | Unverified portfolio |
| Tier 1 | 1,000 | After business verification |
| Tier 2 | 10,000 | First scaling step |
| Tier 3 | 100,000 | Established |
| Tier 4 | Unlimited | Up to 1,000 MPS throughput |

**2026 simplification:** Meta is removing the 2K/10K intermediate tiers; once a business completes verification / the quality path it jumps to a **100k/day baseline** (rollout began Q1 2026, full removal targeted Q2 2026) ([Woztell](https://woztell.com/whatsapp-api-2026-updates-pacing-limits-usernames/), retrieved 2026-07-01). Practical implication: **messaging caps are no longer a real constraint for an event promoter** once verified — the constraint becomes deliverability/quality + pacing.

## 2. Off/Pixel eligibility assessment

- **Realistic tier: Tech Provider.** Off/Pixel qualifies on the only hard gate — a verified business + the ability to build a Cloud API integration + pass App Review. It does **not** yet qualify for Tech Partner (needs 10 active clients + 2,500 msg/day + 90% quality) and Solution Partner is out of scope (credit line/enterprise).
- **Technical requirements Meta reviews:** working Meta app with WhatsApp use case; demonstrable ability to send messages + manage templates; **video evidence** of the app performing these; requested **Advanced access** to `whatsapp_business_messaging` + `whatsapp_business_management` ([Meta: Become a Tech Provider](https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers/), retrieved 2026-07-01). Off/Pixel already has the adjacent infrastructure (Next.js app, Supabase, encrypted-credential pattern, webhook receivers) — the missing piece is a **direct Meta Cloud API integration** (currently intermediated by Bird).
- **Business requirements:** Meta Business Verification (legal name, registered address, tax ID / incorporation docs). Off/Pixel is a real UK Ltd running Meta ad accounts already, so this is low-risk.
- **Reference-customer requirement:** **None to become a Tech Provider.** The 10-active-client bar only applies to the **Tech Partner** upgrade. **UNVERIFIED:** no public evidence of a formal "client attestation" requirement at Tech Provider tier — App Review can be demonstrated against your own integration or a Solution Partner integration.
- **Time to first approval:** **UNVERIFIED with a hard median.** Community reports for App Review + business verification cluster around **2–6 weeks** when documentation and videos are clean, longer if resubmissions are needed. Treat "1–2 months to Tech Provider live" as a planning assumption, not a guarantee.
- **Cost:** **No Meta application fee.** Ongoing cost is **per delivered template message** at Meta's rate card (Marketing highest, Utility mid, Authentication lowest, Service free) — see §7 pricing. There is **no minimum spend commitment** to be a Tech Provider ([Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing/), retrieved 2026-07-01). The real cost is **engineering + ongoing compliance**, not fees.

## 3. Multi-client servicing model

- **One WABA per client — this is effectively absolute.** The dominant, repeatedly-stated best practice is **one WABA per client, one number per WABA**: a policy violation on client A then has **zero** effect on clients B–Z, and data is isolated at Meta's level per WABA ([SocialHook: WhatsApp for agencies](https://socialhook.io/en/blog/whatsapp-business-api-agencies), retrieved 2026-07-01). One Off/Pixel WABA servicing multiple client brand profiles is **not** the recommended (or safe) architecture.
- **How Off/Pixel would technically service many clients:** as a Tech Provider, onboard each client through **Embedded Signup**; the client's WABA + assets are created and **access is granted to Off/Pixel's app**, but **the client retains ownership** and can revoke/transfer if the relationship ends ([Meta: Multi-Partner Solutions](https://developers.facebook.com/docs/whatsapp/solution-providers/multi-partner-solutions/); SocialHook, both retrieved 2026-07-01). A single centralized webhook endpoint handles all clients; every event carries `phone_number_id` to route to the correct client's isolated data.
- **DPA / data-processing implications (UK GDPR + Spanish RGPD):**
  - Under GDPR each **client is the data controller**; **Off/Pixel is a data processor** acting on their behalf. A **signed DPA per client** (Art. 28) is required, covering purpose limitation, TOMs (technical/organisational measures), sub-processors, and **deletion on offboarding** ([SocialHook](https://socialhook.io/en/blog/whatsapp-business-api-agencies); [ChatArchitect: GDPR](https://chatarchitect.com/news/gdpr-and-other-requirements-for-whatsapp-solution-architectures), retrieved 2026-07-01).
  - Meta's **WhatsApp Business Terms for Service Providers** make the service provider responsible for creating a WABA per client and for using client data **solely for that client's benefit** ([whatsapp.com/legal](https://www.whatsapp.com/legal/business-terms-for-service-providers), retrieved 2026-07-01).
  - **Cross-border transfer:** the Cloud API is hosted by Meta (US servers). Post-Schrems II this needs **SCCs / UK-IDTA** safeguards. For Jackies (Spanish RGPD) and any UK client, Off/Pixel's DPA must cover **both** the UK regime (ICO, UK-IDTA) **and** EU SCCs ([ChatArchitect](https://chatarchitect.com/news/gdpr-and-other-requirements-for-whatsapp-solution-architectures); [go4whatsup UK](https://www.go4whatsup.com/uk/), retrieved 2026-07-01).
  - **Data-model requirement:** never mix client contact data in one table; the schema must support per-client deletion from day one. (Off/Pixel's existing per-client `d2c_connections` + encrypted-credentials pattern is a good foundation.)
- **Onboarding a new client to the shared Chat Host:** Embedded Signup itself is minutes for the client (they click through, grant access). The real gate is **proof of opt-in/consent** for the contacts Off/Pixel will message, plus display-name approval + (optionally) green-tick. Assume **days, not minutes** end-to-end because of consent evidence + template approval.
- **Pricing model for Off/Pixel (restated for per-message world):** two viable shapes —
  1. **Flat retainer uplift** ("WhatsApp comms managed" line item, e.g. £300–600/mo/client), with **Meta message costs billed to the client directly** (Tech Provider = no credit line, so this is the natural fit).
  2. **Managed + markup** — only possible if Off/Pixel becomes a **Solution Partner** (credit line) or fronts costs via Bird; carries **financial exposure** (see §5).
- **Competitive positioning / first-mover:** **UNVERIFIED that there are zero UK event-agency-tier BSPs**, but the scan (§13) found **no UK event *marketing agency* operating as a Meta WhatsApp partner** — the field is held by **event-specialist CRMs/BSPs** (Nevent in Spain, Memacon advisory in Germany). Off/Pixel would be an early mover **as an agency**, but would be competing against purpose-built event CRMs, not an empty field.

## 4. Perks unlocked at each tier

| Perk | Tech Provider | Tech Partner | Solution Partner |
|---|---|---|---|
| Send on behalf of clients' WABAs (Advanced access) | ✅ | ✅ | ✅ |
| Embedded Signup onboarding | ✅ | ✅ | ✅ |
| Higher messaging caps (250→1k→10k→100k→unlimited) | ✅ *(driven by client portfolio verification/quality, not partner tier)* | ✅ | ✅ |
| Green-tick / OBA verification | ⚠️ *per-number, merit/notability or Meta Verified — not granted by tier* | ⚠️ same | ⚠️ same |
| Early access to new WA features (Flows, etc.) | Flows available to all Cloud API accounts already | Same + partner previews | Same + partner previews |
| **Groups API** (max 8/group) | ✅ *(requires client's number to be an OBA, not partner tier)* | ✅ | ✅ |
| Large **Community/Group** creation API | ❌ **not exposed at any tier** | ❌ | ❌ |
| Direct Meta support channel | ✅ Direct Support | ✅ Direct Support | ✅ Direct Support |
| SMB Accelerator Program (incentives/enablement) | ❌ | ✅ | ✅ |
| Partner Portal (deal pipeline, incentives) | ❌ | ✅ | ✅ |
| Solution Partner **Directory listing** (lead gen) | ❌ | ⚠️ via Meta Business Partner status | ✅ |
| **Credit line** + bill clients for usage | ❌ (client pays Meta) | ❌ | ✅ |
| Discounted per-message pricing | ❌ *(volume discounts on Utility/Auth are account-driven, not tier-granted)* | ❌ | ⚠️ negotiated |

Sources: [Meta: Partners](https://developers.facebook.com/docs/whatsapp/solution-providers/), [Upgrade to Tech Partner](https://developers.facebook.com/docs/whatsapp/solution-providers/upgrade-to-tech-partner/), [Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups), [OBA](https://www.facebook.com/business/help/604726921052590), [pricing volume tiers](https://developers.facebook.com/docs/whatsapp/pricing/) — all retrieved 2026-07-01.

**Key correction to the brief's mental model:** the two perks Matas most wants — **higher caps** and **green tick** — are **not** unlocked by becoming a partner. Caps track the *client portfolio's* verification/quality; green tick is a **per-number OBA** grant based on notability or a paid **Meta Verified** subscription (§details in §10 / §16). Becoming a Tech Provider gets you the **right to operate the plumbing**, not the badges.

## 5. Downsides + gotchas

- **Reputation contagion is mostly mitigated by one-WABA-per-client** — but **not eliminated**. Off/Pixel's *app* and *portfolio-level* standing can still be affected by patterns across clients (quality signals, policy strikes). A single reckless client can trigger Meta scrutiny of the partner app.
- **Ongoing compliance overhead is real and recurring:** per-number quality ratings, template quality, category-correctness (Marketing vs Utility misclassification gets templates rejected/paused), opt-in tracking, and **pacing** (Meta now batches large sends and can halt remaining batches on negative feedback) ([Woztell](https://woztell.com/whatsapp-api-2026-updates-pacing-limits-usernames/), retrieved 2026-07-01). For a 2-person team this is a **standing operational tax**.
- **Financial exposure:** as a **Tech Provider there is little direct exposure** — clients pay Meta directly, so a client racking up £10k in message costs is **their** bill, not Off/Pixel's. Exposure only appears if Off/Pixel (a) becomes a Solution Partner with a credit line, or (b) keeps fronting costs through Bird and re-bills. **Staying Tech Provider is the exposure-minimising choice.**
- **Regional restrictions:** messaging works UK + Spain fine; **native payments do not** (§7). Some template categories/rates differ by country (UK/Italy/Spain carry a **higher marketing rate** — [Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing/), retrieved 2026-07-01).
- **Losing partner status mid-contract:** if Off/Pixel's Tech Provider app were suspended, clients who own their WABAs could **re-connect via another provider (or Bird) without losing their number/history** — but Off/Pixel's *automation* would be down until re-onboarded. This is an argument for **keeping Bird as a fallback path** even after building direct integration.
- **Build-vs-buy sunk cost:** replacing Bird means owning template management, media hosting, webhook reliability, retries, quality monitoring, and Meta's shape changes — exactly the surface the Bird audit (`D2C_BIRD_TEMPLATES_API_AUDIT`) shows is fiddly and undocumented in places. Bird already absorbs this.

---

# PHASE 2 — WHATSAPP FLOWS + PAYMENTS + TICKETING

## 6. WhatsApp Flows — current state (mid-2026)

- **What it is:** native, multi-screen interactive forms inside a WhatsApp thread (sign-up, booking, lead-qual, catalog/checkout steps). Launched late 2024, expanded through 2025. **Cloud API only** ([Kanal: Flows guide](https://getkanal.com/blog/whatsapp-flows-guide-ecommerce), retrieved 2026-07-01).
- **Static vs dynamic:** static flows handle fixed inputs; **dynamic flows** call an **encrypted data endpoint** on your backend to fetch live data / validate selections ([FusionSync: Flows for events](https://www.fusionsync.ai/posts/whatsapp-flows-event-lead-qualification-2026), retrieved 2026-07-01). Dynamic = the pattern needed for live ticket inventory/pricing, and it adds endpoint-reliability + testing work.
- **Regional availability:** Flows (the form UI + data collection) work in the UK/EU. **Native payment *inside* the Flow does not** (§7).
- **Integration pattern:** define screens/JSON in **Flow Builder** or the **Flows API**; connect a backend as the **Flow Data Endpoint**; launch via a template with a flow token to track each interaction ([FusionSync](https://www.fusionsync.ai/posts/whatsapp-flows-event-lead-qualification-2026); [ShopLinx](https://www.shoplinx.ai/blog/whatsapp-flows-interactive-forms-guide), retrieved 2026-07-01).
- **Cost:** **no separate Flow surcharge.** A Flow is billed at the **category of the template that launches it** — Marketing rate if opened from a marketing template, Utility rate (or free) if opened inside an open 24-hour service window ([Kanal](https://getkanal.com/blog/whatsapp-flows-guide-ecommerce); [Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing/), retrieved 2026-07-01).
- **Builder access:** **all Cloud API accounts**, not partner-tier gated. Off/Pixel can build Flows **today via Bird** (if Bird surfaces Flows) or via direct Cloud API — Tech Provider status is **not** a prerequisite for Flows.
- **Events/ticketing case studies:** the clearest event proof points are **India-centric** (native UPI checkout) — e.g. reported Day-1 sell-through 12%→38% and no-show 22%→8% on Indian venue pilots ([RichAutomate](https://richautomate.in/blog/whatsapp-event-ticketing-venue-india-2026), retrieved 2026-07-01); a Mumbai B2B summit +45% registrations via WhatsApp reg + payment link ([Ominiflow](https://ominiflow.com/blog/case-study-events-registration), retrieved 2026-07-01). Meta's own cross-vertical proof point is **Engelife** (real-estate lead pre-qualification via Flows) ([FusionSync](https://www.fusionsync.ai/posts/whatsapp-flows-event-lead-qualification-2026), retrieved 2026-07-01). **Caveat:** the strongest numbers ride on **native in-chat payment**, which the UK does not have — so they do not transfer cleanly (§9).

## 7. WhatsApp Payments (native) + Stripe/PayPal-in-WA

- **Native WhatsApp Pay is NOT available in the UK, EU, or US in 2026**, and **Meta has published no launch roadmap** for these regions ([Kanal: WhatsApp Pay 2026](https://getkanal.com/blog/whatsapp-pay-2026); [MercaBot](https://mercabot.com.br/en/blog/whatsapp-pay-brasil-2026-status/), retrieved 2026-07-01).
- **Where native pay works:** **India** (UPI, P2P + merchant, most mature), **Singapore** (business/merchant payments via partners), **Brazil** (P2P live; **business card payments discontinued 15 Jan 2026**; Pix/links continue) ([Kanal](https://getkanal.com/blog/whatsapp-pay-2026); [Infobip](https://www.infobip.com/blog/whatsapp-payments), retrieved 2026-07-01). Mexico, UK, US "under consideration, no dates, some rollouts stalled" ([Infobip](https://www.infobip.com/blog/whatsapp-payments), retrieved 2026-07-01).
- **Meta + Stripe in-WA checkout for UK/EU:** **no verified native integration.** The UK/EU pattern is a **hosted payment link (Stripe / Square / PayPal) sent in the chat** — the customer taps, pays on a secure external page (card / Apple Pay / Google Pay / Link), and a webhook confirms status back into the thread ([MercaBot](https://mercabot.com.br/en/blog/whatsapp-pay-brasil-2026-status/); [Kanal](https://getkanal.com/blog/whatsapp-pay-2026), retrieved 2026-07-01). Adyen/Rapyd are enterprise gateways with no special WA-native UK path (**UNVERIFIED** any WA-native advantage).
- **End-user experience (UK reality):** "click ticket" → tap CTA/link → **external checkout page** (2–4 taps) → back to WhatsApp for confirmation/QR. It is **not** the 1-tap in-thread purchase the India numbers describe.
- **Merchant setup:** a Stripe/PayPal account + payment-link generation + a webhook to reconcile — which Off/Pixel can already build; it is not gated by any WhatsApp partner tier.
- **Blunt conclusion:** for Off/Pixel's UK/Spain event clients, **"in-chat checkout" = "external checkout linked from chat."** The value is the **channel** (open rate, immediacy), not a true native pay experience.

## 8. Ticketing platform APIs (event-industry specific)

| Platform | Programmatic order/inventory API? | Embedded checkout / redirect? | WA/WA-Flow partnership? | Pitch contact | Uplift claims |
|---|---|---|---|---|---|
| **Eventbrite** | **Yes** — full REST v3: create events, ticket_classes, read orders/attendees, webhooks; OAuth bearer; 1,000 calls/hr, 48k/day ([FreeAPIHub](https://freeapihub.com/apis/eventbrite-api); [routing ref](https://github.com/maton-ai/api-gateway-skill/blob/HEAD/references/eventbrite/README.md), retrieved 2026-07-01). **Already integrated in Off/Pixel** (`EVENTBRITE_TOKEN_KEY`). | Widgets + redirect | None found (**UNVERIFIED**) | Eventbrite Platform / API docs | n/a |
| **DICE** | **Partner API (GraphQL via "MIO")** for event data + ticket-holder data; **not** open self-serve order creation | Website checkout + Spotify/YouTube integrations | None found (**UNVERIFIED**) | **Partner form** at [dice.fm/partners](https://dice.fm/partners/ticketing/live) (retrieved 2026-07-01) | "1% of tickets prompted by Discovery" (marketing claim) |
| **Resident Advisor (RA)** | **No public API** — RA Pro is a closed ticketing suite; comparison tables list **API Access: No** ([TicketFairy comparison](https://www.ticketfairy.ca/dice-vs-resident-advisor), retrieved 2026-07-01) | No public embed | None found (**UNVERIFIED**) | **Partnership form** at [pro.ra.co](https://pro.ra.co/) (retrieved 2026-07-01) | n/a |
| **Skiddle** | **REST API (Beta), non-commercial only** unless approved in writing; free key on application ([skiddle.com/api](https://www.skiddle.com/api/), retrieved 2026-07-01) | n/a | None found | **dev@skiddle.com** for commercial approval | n/a |
| **Fatsoma** | **No public developer API found** — offers **embeddable Checkout + free Event Widgets** (copy-paste embed code); 3-tap checkout, Apple/Google Pay ([Fatsoma Checkout](https://ticketing.fatsoma.com/f/checkout); [Widgets](https://ticketing.fatsoma.com/f/event-widgets), retrieved 2026-07-01) | **Yes — embed widget** | None found | Fatsoma sales/"Get Started" | "checkout in <10s" (marketing) |
| **Ticketweb** | **No public developer API found** (**UNVERIFIED** — Ticketmaster/Live Nation-owned; likely closed/partner-only) | Unknown | None found | Account manager / Ticketmaster partnerships | n/a |

**Read-through:** the electronic-music platforms Off/Pixel's clients actually use most (**RA, DICE**) are the **least API-open** — RA has no API, DICE is partner-gated with no order-creation surface. The **only clean programmatic order path is Eventbrite** (already wired). So a "WA checkout Flow that creates a real order in the client's ticketing platform" is **only viable today for Eventbrite events** (and, with written approval, Skiddle). For RA/DICE the realistic pattern is **WA → payment link OR WA → deep-link into the platform's own checkout**, not a true in-Flow order.

## 9. Conversion-uplift evidence

- **Channel-level (transferable):** WhatsApp abandoned-cart / recovery consistently reports **15–30%** vs email **2–5%**, driven by **~90%+ open rates** ([Kanal](https://getkanal.com/blog/whatsapp-vs-email-abandoned-cart-recovery); [Blueticks](https://blueticks.co/blog/whatsapp-ecommerce-at-scale-shopify-case-study), retrieved 2026-07-01). Baymard pegs baseline cart abandonment at ~70% ([via Blueticks](https://blueticks.co/blog/whatsapp-ecommerce-at-scale-shopify-case-study), retrieved 2026-07-01). Catalog/checkout Flows: Sefamerve reported **2.6× revenue, +158% conversion** over 4 months ([InfluencerMarketingHub](https://influencermarketinghub.com/whatsapp-flows-for-checkout/), retrieved 2026-07-01).
- **Event-specific (partially transferable):** the strong event numbers (Day-1 sell-through 12%→38%; +45% registrations) are **India, with native UPI in-chat payment** — the payment friction is genuinely removed there ([RichAutomate](https://richautomate.in/blog/whatsapp-event-ticketing-venue-india-2026); [Ominiflow](https://ominiflow.com/blog/case-study-events-registration), retrieved 2026-07-01).
- **Directional estimate for Off/Pixel (UK/Spain events, external checkout):** the uplift Off/Pixel can realistically bank is the **channel effect** (reach + open rate + immediacy of a targeted drop to opted-in fans), **not** the native-pay effect. Expect the win to look like **email/SMS → WhatsApp broadcast uplift** (multiples on open/click, meaningful but not the 3× India checkout figures), **minus** the tap or two lost to an external checkout page.
- **Honest ceiling:** UK/EU buyers already trust known external checkouts (RA/DICE/Fatsoma/Stripe). Removing the redirect saves seconds, not a purchase decision. **The rational take (echoed in sources): "trading 6+ months of build for a 30-second UX improvement is bad math"** ([MercaBot](https://mercabot.com.br/en/blog/whatsapp-pay-brasil-2026-status/), retrieved 2026-07-01). The bankable value is **WhatsApp as a marketing/announcement + reminder channel**, where Off/Pixel already operates via Bird.

---

# PHASE 3 — COMBINED PATH ANALYSIS

## 10. Do partner status + Flows/checkout unlock the group-creation bottleneck?

Cross-referencing the intended tactical **WA Group Management Audit** (`docs/audits/WA_GROUP_MANAGEMENT_AUDIT_2026-06-30.md` — **not present in the repo at time of writing; treat this section as the strategic-layer answer pending that doc**):

- **Community Business / large-Group creation API at Tech Provider tier?** **No.** The Groups API is open to all **OBA** businesses but is capped at **8 participants/group** (max 10,000 groups/number) ([Meta Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups), retrieved 2026-07-01). There is **no API to create large WhatsApp Communities/Groups** at any partner tier. Matas's chat-host use case (large per-event community groups) is **not unlocked** by becoming a partner.
- **Note on OBA prerequisite:** even the 8-person Groups API requires the client number to be an **Official Business Account (green tick)** — which itself needs business verification / notability or a **Meta Verified** subscription ([OBA help](https://www.facebook.com/business/help/604726921052590); [Uptail](https://www.uptail.ai/blog/whatsapp-green-tick-verification-for-business), retrieved 2026-07-01). So even the *small*-group automation has a gating step Off/Pixel doesn't control per-client.
- **Does partner tier give a priority queue for feature requests?** Partially. **Tech Provider gets Direct Support**; **Tech Partner + SMB Accelerate + Partner Portal** give a formal channel to Meta ([Meta: Partners](https://developers.facebook.com/docs/whatsapp/solution-providers/); [Upgrade to Tech Partner](https://developers.facebook.com/docs/whatsapp/solution-providers/upgrade-to-tech-partner/), retrieved 2026-07-01). This is **influence, not a roadmap guarantee** — a large-group API is not on any public roadmap.
- **Would demonstrating a needed-but-unexposed feature strengthen the partner case?** Marginally, for narrative. But you don't need partner status to *ask* — and Meta is unlikely to expose consumer-Community creation to automation for anti-spam reasons. **Do not build the partner business case on unlocking this.**
- **Indirect wins that DO transfer to the D2C bottlenecks:**
  - **Brief→campaign / member reporting:** owning the Cloud API (or continuing via Bird) gives cleaner **delivery/read webhooks + `phone_number_id` routing** → better per-event member reporting than scraping. This is achievable **today via Bird**, no partner status required.
  - **Group *invite* distribution (not creation):** the 8-person Groups API + invite-link templates could automate **small VIP/guestlist pods**, and the community-URL paste flow (`d2c_event_copy.whatsapp_community_url`) remains the mechanism for large groups. Partner status doesn't change this.

**Verdict for §10:** the headline synergy (partner status unlocks group creation) is **false**. The genuine automation wins (reporting, invite distribution, brief→campaign) are **available now through Bird** and do **not** require becoming a Meta partner.

## 11. Off/Pixel revenue-model implications

**Baseline (from CLAUDE.md + strategic reflections):** ~£13k MRR today; £20k target. Client mix: Louder ~£5k/mo, Jackies ~€4.5k/mo (~£3.8k), 4theFans ~£1k/mo, Junction 2 ~£17k across 5 events (project, not MRR), plus smaller retainers. Dashboard line-item benchmark £500–800/mo (reflection 2026-05-08). *All scenario figures below are modelled assumptions, clearly labelled — not Meta or client commitments.*

### Scenario A — Status quo (no partner status)
- **Revenue:** organic path to £20k via headcount/services growth + dashboard-as-line-item (£500–800/mo/client) + 1–2 new retainers. Reflection already models a credible **£15–17k by mid-year without hiring**.
- **Cost:** ~£0 net-new; WhatsApp continues via Bird (per-message pass-through + Bird platform fee).
- **Effort:** low — continue current roadmap.
- **Risk:** low. WhatsApp remains a *feature* of the D2C service, not a product.
- **12-mo ARR trajectory:** £156k → ~£216–240k (from the £18–20k MRR target).

### Scenario B — Tech Provider + Flows "checkout" (external-link) as a client add-on
- **Assumptions (modelled):**
  - WhatsApp comms retainer uplift: **+£400/mo/client** (managed templates, drops, reminders, Flows lead-capture).
  - Message costs (Meta) billed **directly to client** (Tech Provider = no credit line) → **£0 COGS to Off/Pixel**, no exposure.
  - Onboard **6 new clients over 12 months** on the "WhatsApp + dashboard" value prop, at **£400 (WA) + £600 (dashboard) = £1,000/mo/client**.
- **Revenue:** existing 5 clients: assume 3 adopt WA uplift = **+£1,200/mo**. 6 new clients ramping (say avg 3 live months each over the year) → run-rate exit **+£6,000/mo** WA+dashboard. **Exit MRR ≈ £13k + £1.2k + £6k ≈ £20.2k**, ARR run-rate **≈ £242k**.
- **Cost:** engineering to replace/augment Bird with direct Cloud API + Flows endpoint + quality monitoring (**~6–10 Cursor/dev weeks** spread over the year), plus ongoing compliance tax.
- **Effort:** high (build + App Review + per-client onboarding + DPAs).
- **Risk:** medium — build risk, Meta shape-change risk, and the honest §9 ceiling (external checkout ≠ native pay, so the "checkout uplift share" is thin; monetise the **managed channel**, not a % of ticket sales).

### Scenario C — Partner status, no checkout build
- **Revenue:** partner status **alone monetises little** — the badges Matas wants (caps, green tick) aren't tier-granted (§4). The only monetisable perks are **operational efficiency** (own the plumbing, better reporting) and a **positioning story** ("official WhatsApp partner"). Modelled uplift: perhaps **+£150–250/mo/client** as a "managed WhatsApp" line, adopted by a few clients → **+£0.5–1k/mo**.
- **Cost:** the **same App Review + build cost** as B, with **less** revenue to show for it.
- **Effort:** medium-high.
- **Risk:** medium — you pay most of B's cost for a fraction of B's upside. **Weakest scenario.**

**Summary:** Scenario A reaches the £20k target on its own. Scenario B *also* reaches ~£20k but adds resilience/positioning **if** clients actually pay for managed WhatsApp — with the caveat that the incremental revenue is the **retainer uplift**, not checkout economics. Scenario C is dominated (costs of B, upside of little).

## 12. Timeline realism (if Matas started tomorrow)

```
Month:            1     2     3     4     5     6     7     8     9    10    11    12
Meta app + BV     ■■
App Review        ░░■■■■
Tech Provider live      ●
Direct Cloud API build  ░░■■■■■■
Flows endpoint + tmpl         ░░■■■■
DPAs + opt-in framework ░░■■
Client 1 onboarded          ●
First WA "checkout" Flow live (Eventbrite client)  ●
Clients 2-3 onboarded             ░░●
Green tick / Meta Verified (per client)   ░░░░░░
Multi-client servicing at scale                    ░░░░░●
Tech Partner eligibility check (needs 10 clients)             (not before y2)
```
- **Months 1–3:** business verification + App Review → **Tech Provider live** (planning assumption; §2 timing is UNVERIFIED).
- **Months 3–6:** direct Cloud API integration + Flows data endpoint; migrate one brand off Bird as a pilot (keep Bird as fallback).
- **Months 4–7:** first client onboarded via Embedded Signup with DPA + opt-in evidence.
- **Months 6–9:** first WA "checkout" Flow for a presale — **Eventbrite-backed** (only clean order API); RA/DICE stay redirect-only.
- **Months 9–12:** 3–6 clients on managed WhatsApp. **Tech Partner (10 clients + 2,500 msg/day) is year-2**, not year-1.

## 13. Competitive scan

- **No UK event *marketing agency* found operating as a Meta WhatsApp partner** (**UNVERIFIED** as exhaustive, but none surfaced). The space is held by:
  - **Nevent** (Spain) — event-industry WhatsApp marketing built on WABA, manages green-badge + migration, CRM/ticketing sync, segmentation ("VIP buyers who haven't repurchased"). Directly overlaps Jackies' market. [nevent.ai](https://nevent.ai/en/features/whatsapp-marketing/) (retrieved 2026-07-01).
  - **Memacon** (Germany) — nightlife/club **advisory** on selecting a WA BSP + compliant setup (not itself the partner). [memacon.com](https://www.memacon.com/whatsapp-for-nightclubs/) (retrieved 2026-07-01).
  - **go4whatsup** (UK) — UK-GDPR/ICO-aligned WhatsApp CRM, signed DPA, UK data residency, message costs passed through at Meta UK rates. [go4whatsup.com/uk](https://www.go4whatsup.com/uk/) (retrieved 2026-07-01).
  - **Horizontal BSPs** (Omnichat, 360dialog, Twilio, Infobip, Bird) — Solution Partners in Meta's directory. [Omnichat comparison](https://blog.omnichat.ai/whatsapp-business-solution-provider-comparison/) (retrieved 2026-07-01).
- **Learn / avoid / differentiate:**
  - **Avoid** competing with horizontal BSPs on plumbing — they win on scale/price.
  - **Learn** from Nevent: the winning event pitch is **CRM/ticketing-integrated segmentation + measurable ticket-revenue attribution**, not raw messaging.
  - **Differentiate** on what Off/Pixel already has that Nevent-type CRMs don't: the **reconciled multi-platform dashboard + paid-media execution + attribution**. WhatsApp becomes **one more owned channel feeding the same dashboard** — the moat is the *integrated funnel view*, not being a WhatsApp partner per se.

---

# PHASE 4 — DECISION MATRIX + RECOMMENDATION

## 14. Three concrete paths

| | **Path A — Don't pursue partner** | **Path B — Partner, internal tool only** | **Path C — Full ambition (partner + client hub + WA checkout)** |
|---|---|---|---|
| **What** | Keep delivering via Bird; clients own their WABAs; focus on D2C automation + dashboard | Become Tech Provider; use Off/Pixel Chat Host as an **internal** efficiency layer, not a sold product | Tech Provider + Embedded-Signup client hub + Flows "checkout" (external-link) for event presales |
| **When it's right** | If WhatsApp stays a *feature*, and dev time is better spent on dashboard/automation | If Bird's fees/limits become painful and owning the pipe saves real money/time | If ≥3 clients will **pay a managed-WhatsApp uplift** and adopt an Off/Pixel-managed WABA |
| **Cost** | ~£0 net-new | App Review + Cloud API build (~4–8 dev weeks); ~£0 Meta fees | B's build + Flows endpoint + DPAs (~6–10 dev weeks) + ongoing compliance |
| **Effort** | Low | Medium | High |
| **Revenue ceiling** | £20k via existing levers | Marginal direct revenue; savings only | ~£20k with WA uplift monetised (retainer, not checkout %) |
| **Risk** | Low | Medium (build for internal-only ROI) | Medium (build + Meta + thin checkout ceiling) |

## 15. Opus verdict

**Recommendation: Path A now, with a scoped, reversible pilot toward Path C — but do NOT become a Meta Tech Provider yet.**

Reasoning:
1. **The two headline reasons to become a partner don't hold.** Higher caps and green tick are **not** tier-granted (§4); the group-creation bottleneck is **not** unlocked at any tier (§10); native in-chat payment **doesn't exist in the UK/EU** (§7); and **Off/Pixel already operates the WhatsApp API through Bird** (§0.2). Becoming a Tech Provider buys the *right to own the plumbing you already rent* — a cost centre, not a revenue unlock.
2. **The real revenue lever is "managed WhatsApp as a client line-item"** — and that can be sold and delivered **today via Bird**, testing willingness-to-pay **before** spending 6–10 dev weeks replacing the pipe. Prove demand first.
3. **The one genuinely valuable new capability — a WA "checkout" Flow — is only cleanly buildable for Eventbrite events** (RA/DICE have no order API) and yields a **channel** uplift, not a native-pay uplift. That's worth piloting on **one Eventbrite-backed presale via Bird's Flows support**, not worth a partner migration.
4. **Sequencing:** monetise managed WhatsApp on Bird → run one Flows presale pilot → **only if** (a) ≥3 clients pay the uplift, (b) Bird's fees/limits demonstrably cost more than owning the pipe, and (c) a client will adopt an Off/Pixel-managed WABA — **then** graduate to Path C and file for Tech Provider. Tech **Partner** stays a year-2 goal (needs 10 clients + 2,500 msg/day).

**Evidence that would flip this to "apply for Tech Provider now":**
- Bird's fees/limits are already materially throttling the D2C roadmap (hard numbers on cost or blocked features).
- ≥3 current clients verbally commit to a **£300–500/mo managed-WhatsApp uplift** and to an Off/Pixel-managed WABA.
- Meta ships (or gives partner-preview of) a **large-Community creation API** — the single change that would make the chat-host business scalable.
- A flagship client (e.g. Junction 2 or Louder) wants a WA presale checkout **on Eventbrite** with attribution into the dashboard, as a paid engagement.

## 16. Application-day-1 checklist (only if Matas chooses Path B or C)

**Log into:** [business.facebook.com](https://business.facebook.com) (Off/Pixel Business Portfolio) and [developers.facebook.com](https://developers.facebook.com) with the Off/Pixel admin account.

**This week:**
1. **Confirm Business Verification** is complete for the Off/Pixel portfolio (Security Centre → legal name, registered address, tax ID / Companies House doc). This is the long pole — start here.
2. **Create a Meta app** with the **WhatsApp use case**, connected to the verified portfolio ([Meta: Become a Tech Provider](https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers/)).
3. **Prepare App Review assets:** screen-recordings showing the app **sending a message** and **managing a template**, plus a written description of the integration. Request **Advanced access** to `whatsapp_business_messaging` + `whatsapp_business_management`.
4. **Draft the DPA template** (Art. 28) covering UK-GDPR (ICO, UK-IDTA) + EU SCCs for Jackies — one signable per client (§3).
5. **Draft the business-case narrative** (below).
6. **Decide green-tick route per client:** organic OBA (needs verification/notability — 3–5 organic press articles) **or** paid **Meta Verified** subscription ([OBA help](https://www.facebook.com/business/help/604726921052590)).

**Documents to have ready:** Companies House registration, VAT/VRN, proof of address, Off/Pixel website with matching brand/display name, per-client opt-in evidence, per-client DPA.

**Draft business-case narrative (for App Review / partner context):**
> *Off/Pixel is a UK event-marketing agency operating reconciled multi-platform ad + reporting infrastructure for electronic-music and live-event promoters (Louder, Jackies, Junction 2, 4theFans). We are building a WhatsApp messaging layer that lets each client run compliant, opt-in event announcements, presale reminders, and interactive ticket-info Flows against their own WhatsApp Business Account, with delivery/engagement attributed into our unified event-performance dashboard. We onboard clients via Embedded Signup; each client owns their WABA and data; we act as data processor under a signed DPA. Our integration sends template messages, manages templates, and processes Flow responses via encrypted endpoints.*

---

# PHASE 5 — QUESTIONS FOR MATAS (numbered; each could flip the recommendation)

1. **Willingness-to-pay:** Would **≥3 current clients pay a £300–500/mo "managed WhatsApp" uplift** — and can we test that on Bird **before** any partner build? *(Flips A→B/C if yes.)*
2. **WABA ownership:** Which clients would agree to an **Off/Pixel-managed WABA under Embedded Signup** vs insisting on running their own? *(If none will, Path C's "servicing hub" collapses.)*
3. **Bird pain quantified:** What are we **actually paying Bird** (platform fee + per-message), and has Bird ever **blocked a feature or a limit** we needed? *(Hard numbers here are the strongest flip toward owning the pipe.)*
4. **Unpaid-usage exposure:** If we ever front message costs, how would we handle a client **racking up £10k in unpaid message costs**? *(Answer: stay Tech Provider so clients pay Meta directly — confirm we're OK never having a credit line / never re-billing usage.)*
5. **Checkout ambition realism:** Given native WhatsApp Pay **does not exist in the UK/EU**, is a **WhatsApp → external Stripe/Eventbrite checkout** (2–4 taps) still worth building, or is the value just WhatsApp-as-announcement-channel? *(If the latter, Flows checkout drops off the roadmap.)*
6. **Ticketing reality:** Our clients lean on **RA and DICE**, which have **no open order API**. Are any flagship events on **Eventbrite** (the only clean order API) to pilot a real in-Flow order? *(Determines whether "WA checkout" is buildable at all near-term.)*
7. **Green tick:** For which clients is a **green tick** worth pursuing (organic notability vs paid Meta Verified), given it's per-number and not partner-granted?
8. **Group creation:** Given no API creates **large** WhatsApp Communities, are we content to keep the **community-URL paste** flow for big groups and only automate **≤8-person VIP pods**? *(If a large-group API is a hard requirement, none of the paths deliver it.)*
9. **12-month Meta commitment:** Are we willing to take on the **standing compliance tax** (quality ratings, template categories, opt-in tracking, pacing) that comes with owning the pipe — as a 2-person team?
10. **Positioning:** Do we want to compete with **event-specialist WhatsApp CRMs (e.g. Nevent)** head-on, or keep WhatsApp as **one channel feeding our differentiated dashboard** (the recommended moat)?

---

## Appendix — source ledger (all retrieved 2026-07-01)

- Meta — Partners (Solution Partner / Tech Provider / Tech Partner): https://developers.facebook.com/docs/whatsapp/solution-providers/
- Meta — Become a Tech Provider: https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers/
- Meta — Upgrading to a Tech Partner (2,500 msg/day, 10 clients, 90% quality): https://developers.facebook.com/docs/whatsapp/solution-providers/upgrade-to-tech-partner/
- Meta — Multi-Partner Solutions (Embedded Signup, joint asset access): https://developers.facebook.com/docs/whatsapp/solution-providers/multi-partner-solutions/
- Meta — Pricing (per-message since 1 Jul 2025; conversation pricing deprecated; UK/IT/ES higher marketing rate; utility free in CSW; volume tiers): https://developers.facebook.com/docs/whatsapp/pricing/
- Meta — Groups API (open to OBA, max 8 participants, 10k groups/number): https://developers.facebook.com/documentation/business-messaging/whatsapp/groups
- Meta — Request an Official Business Account (green tick criteria): https://www.facebook.com/business/help/604726921052590
- Meta — WhatsApp Business Terms for Service Providers: https://www.whatsapp.com/legal/business-terms-for-service-providers
- Messaging tiers 2026 (portfolio-based since 7 Oct 2025; 250→unlimited): https://chatarmin.com/en/blog/whats-app-messaging-limits ; https://documentation.bloomreach.com/engagement/docs/whatsapp-messaging-limits
- 2026 tier simplification (2K/10K removed → 100k baseline; pacing): https://woztell.com/whatsapp-api-2026-updates-pacing-limits-usernames/
- UK per-message rates: https://whautomate.com/tools/whatsapp-business-api-pricing-calculator ; https://flowcall.co/blog/whatsapp-business-api-pricing
- Agency multi-client model + GDPR/DPA (one WABA per client): https://socialhook.io/en/blog/whatsapp-business-api-agencies ; https://chatarchitect.com/news/gdpr-and-other-requirements-for-whatsapp-solution-architectures
- WhatsApp Flows (Cloud-API only; static/dynamic; no surcharge): https://getkanal.com/blog/whatsapp-flows-guide-ecommerce ; https://www.fusionsync.ai/posts/whatsapp-flows-event-lead-qualification-2026 ; https://www.shoplinx.ai/blog/whatsapp-flows-interactive-forms-guide
- WhatsApp Pay regions (not UK/EU; India/Singapore; Brazil biz-card ended 15 Jan 2026): https://getkanal.com/blog/whatsapp-pay-2026 ; https://mercabot.com.br/en/blog/whatsapp-pay-brasil-2026-status/ ; https://www.infobip.com/blog/whatsapp-payments
- Ticketing APIs — Eventbrite: https://freeapihub.com/apis/eventbrite-api ; https://github.com/maton-ai/api-gateway-skill/blob/HEAD/references/eventbrite/README.md — DICE: https://dice.fm/partners/ticketing/live — RA: https://pro.ra.co/ ; https://www.ticketfairy.ca/dice-vs-resident-advisor — Skiddle: https://www.skiddle.com/api/ — Fatsoma: https://ticketing.fatsoma.com/f/checkout ; https://ticketing.fatsoma.com/f/event-widgets
- Conversion uplift: https://getkanal.com/blog/whatsapp-vs-email-abandoned-cart-recovery ; https://blueticks.co/blog/whatsapp-ecommerce-at-scale-shopify-case-study ; https://influencermarketinghub.com/whatsapp-flows-for-checkout/ ; https://richautomate.in/blog/whatsapp-event-ticketing-venue-india-2026 ; https://ominiflow.com/blog/case-study-events-registration
- Competitive scan: https://nevent.ai/en/features/whatsapp-marketing/ ; https://www.memacon.com/whatsapp-for-nightclubs/ ; https://www.go4whatsup.com/uk/ ; https://blog.omnichat.ai/whatsapp-business-solution-provider-comparison/
- Green tick / OBA / Meta Verified: https://www.uptail.ai/blog/whatsapp-green-tick-verification-for-business ; https://telecrm.in/blog/whatsapp-blue-tick/

**Internal cross-references:** `CLAUDE.md` (D2C stack, env vars, 3-of-3 live gate), `docs/audits/D2C_BIRD_TEMPLATES_API_AUDIT_2026-06-30.md` (current Bird/WABA integration), `docs/STRATEGIC_REFLECTION_2026-05-08.md` (MRR trajectory, pricing posture). **Missing at write time:** `docs/audits/WA_GROUP_MANAGEMENT_AUDIT_2026-06-30.md` (referenced by the brief; §10 answers the strategic layer pending that tactical doc).
