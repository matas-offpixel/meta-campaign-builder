# Handover — Product Naming for Fan-Facing Landing Page (→ Commercial+Ops)

**Date:** 2026-07-04
**From:** Cowork product/design thread
**To:** Commercial+Ops thread
**Decision needed:** Lock the fan-facing domain + product name for OP1 (landing page tool), register it, run trademark check.

---

## Strategic direction landed

Off/Pixel becomes a **product studio** shipping numbered releases (OPn), not just a services agency. Each release is a discrete tool in the catalog. Pattern is culturally borrowed from:

- **Roland synths / drum machines** (TR-808, TR-909, TB-303, SH-101) — culturally-charged model numbers
- **New Balance sneakers** (574, 530, 2002R, 9060, 990) — each numeral has distinct identity/reputation
- **Teenage Engineering** (OP-1, OP-Z) — the direct OP nod
- **A24** (short alphanumeric brand)

Each release name should carry its own cultural weight, not be a sequential counter.

## The problem to solve

Need the **fan-facing domain** for OP1 (the landing page tool). This is what a fan sees when clicking a presale signup link from a promoter's marketing (`domain.com/{client-slug}/{event-slug}`).

## Non-negotiable constraints (from this session)

1. **.com only.** Cobrand.com, Laylo.com, Splice.com — all .com. Matas explicit: nothing less.
2. **Cannot contain "offpixel"** — artists/promoters won't push a page that shouts the agency name at their fans.
3. **Distinct fan-facing brand** — neutral to civilian fans, subtle industry-side nod to Off/Pixel.
4. **OP + number pattern preferred** — reads as a product release from a broader catalog.
5. **Short + memorable** — fits DMs, bios, QR codes, verbal pitching.

## What's been considered and rejected

| Option | Verdict |
|---|---|
| **OP1.com / OP7.com / OP2.com** | Taken, £50k+ squatter buyouts |
| **o-p-1.com hyphenated (£0.01/yr)** | Hard downgrade — hyphens carry 2000s baggage, verbal comms break, sends 90% typed traffic to taken op1.com |
| **OP-prefix coined (opix, opna, opixel, oplyn, opair, opluxe, oplaunch, opdrop, opvibe, opfan, oply, opxy, opzed, opven, oplyx, opric, opril, opzi, opzy, opza, opzo, opset)** | 22/23 tried are TAKEN. Only `opixly.com` free — sounds clunky |
| **Longer OP names** (opixera, opluxor, opvento) | Read corporate/fintech, lose crispness |
| **Non-.com TLDs** (op1.io, op1.fm) | Rejected — .com required |
| **offpixel.com upgrade** | Taken (parked squatter, ~£500-5k acquisition), but Matas confirmed offpixel-in-URL conflicts with fan-facing neutrality anyway |

## Current leading candidate

### `op909.com` — **available at reg price (~£10-20/yr)**

**Why it's strong:**
- TR-909 = single most iconic number in house/techno music production
- Every current Off/Pixel client sits inside 909's cultural gravity: BWL, Louder, Junction 2, Deep House Bible, One Life (Michael Bibi), Anyma-adjacent, Paradise (Jamie Jones), Eastern Electrics, Junction 2, Boudica
- 5 characters, easy to say ("op-nine-oh-nine")
- Reads clean in Futura Bold Italic box logo (matches the Supreme aesthetic already shipped in PR #670)
- Neutral to fans (they just remember the shape "op909")
- Loud to industry (any producer/DJ/promoter clocks 909 instantly)
- Series-extensible with equal-cultural-weight successors

## Other available fallbacks (all .com, all reg price)

| Domain | Reference | Vibe |
|---|---|---|
| `op707.com` | Roland TR-707 drum machine (cult) / Boeing 707 | Distinctive, less obvious |
| `op007.com` | James Bond | Premium, spy-tech feel |
| `op202.com` | Korg 202 loop (real product) | More neutral, less music-specific |
| `op1010.com` | Teenage Engineering OP-1010 sampler / binary 10 | Geeky, cross-cultural |

## What C+O needs to decide

1. **Lock the name** — OP909 vs alternative
2. **Register the domain** immediately (Namecheap or Cloudflare, ~£8-15/yr)
3. **Register defensive variants** to prevent typosquatting: `op909.co`, `op909.io`, `op909.uk`, `op909.app`, `op909.club` — total ~£60-100/yr
4. **UK IPO trademark search** — for OP909 in:
   - Nice class 42 (SaaS)
   - Nice class 35 (advertising/marketing services)
5. **Roland trademark check** — TR-909 is Roland's registered mark, but numeric-alone in a different Nice class may be defensible. Worth 20 min with a solicitor before spending on trademark filing.
6. **Companies House check** — is there an existing UK company called OP909 or similar? Quick search at find-and-update.company-information.service.gov.uk.
7. **Social handles** — @op909 on IG, TikTok, X. Grab even if not used yet.

## Product catalog positioning (if OP909 locked)

Every module in the agency-os stack rebrands as a numbered release under Off/Pixel:

| Release | Product | Domain | Status |
|---|---|---|---|
| **OP909** | Fan-facing landing pages | op909.com ✅ | Live (PR #670, this week) |
| **OP707** | Ticketing layer | op707.com ✅ | Backlog |
| **OP303** | Campaign creator (Meta wizard) | op303.com (taken — investigate buyout OR fallback to op202/op1010) | Existing, rebrand |
| **OP1010** | Reporting dashboards | op1010.com ✅ | Existing, rebrand |
| **OP007** | D2C orchestration | op007.com ✅ | Existing, rebrand |
| **(TBC)** | Creative studio (Remotion + asset queue) | Pending | Existing, rebrand |
| **(TBC)** | Data workshops (Sarah's leg) | Pending | Existing service |

## Brand pivot implication (worth pausing on)

This shifts Off/Pixel's positioning:

- **From:** "The agency that runs your campaigns"
- **To:** "The studio that ships tools you use"

Both continue to feed each other (services fund product, product deepens services). But the Off/Pixel homepage becomes a **releases catalog** (Supreme-lookbook grid), not a service menu. Marketing focuses on the drops. Client comms reference "our OP909 tool" instead of "our landing page product."

## Design language already locked (from PR #670)

Fan-facing pages already ship with Supreme-inspired treatment:

- Monospace body throughout (SF Mono / Menlo stack)
- Futura Bold Italic box logo (red/palette-accent bg)
- Zero border-radius everywhere
- 0.5px black borders on inputs
- Full-width edge-to-edge artwork carousel
- Countdown block, YouTube lite-embed, 4-col image grid
- Timestamp meta swap (in-progress PR #671 replaces "current time" with "On sale: HH:mm EEE d MMMM")
- "~ made with off/pixel ~" footer for industry attribution

The box logo will render **OP909** in Futura Bold Italic — this is where the wordmark lives.

## Immediate action (before someone else runs the same search)

Register `op909.com` within 24-48h even if C+O hasn't fully locked the name. £10-15/yr is a trivial hedge; losing the domain to a squatter after this conversation would be avoidable regret.

Defensive TLDs (`op909.co`, `.io`, `.uk`, `.app`) can follow within a week.

---

## Session artefacts referenced

- **PR #670** (merged 2026-07-04): Supreme aesthetic renderer shipped live at `app.offpixel.co.uk/l/gmc-worldwide-productions/jackies-open-air-house-music-festival-mallorca-wlf8br`
- **PR #671** (in flight): 7 UX polish tweaks including countdown restyle, on-sale timestamp swap, invisible Turnstile, 4-col grid + 2px white gutters, share button moved to post-signup state
- **Migration 136** applied live — legacy PII cols dropped, geo cols + landing-page config cols added
- **RDAP batch check** of 30+ candidate domains executed this session (results embedded above)
