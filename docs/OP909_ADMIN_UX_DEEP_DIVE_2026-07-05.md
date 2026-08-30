# OP909 Admin Dashboard — Deep-Dive UX Review

**Date:** 2026-07-05
**Compared:** current `/admin/gmc-worldwide-productions` vs Evntr.ee `/admin/pages` + `/admin/fans`
**Cross-referenced:** Co:brand differentiators from prior session memory
**Aesthetic target:** Supreme × Apple — mono, sharp, minimalist, standalone brand identity

---

## Executive summary

The overnight-shipped dashboard is **functionally complete** — all 10 phases live, RLS working, CRUD working. But visually + interactionally it reads as a **cozy startup MVP** rather than a premium standalone product. To hit the Supreme × Apple ambition, three moves in sequence:

1. **Aesthetic pivot** (highest leverage, mostly CSS) — pure white bg, zero radius, 0.5px black hairlines, mono type unified with LP
2. **UX polish per Matas's explicit asks** — title clickable + path copy, thumbnails, geo-tagged fans, analytics-first Fans page
3. **Borrowed patterns from Co:brand** (deferred to Sprint 3) — behavioral segmentation, sortable Followers column, Message Fans composer

---

## What Evntr.ee does better

### Pages list
1. **Artwork thumbnails on every row** — 48px square visual anchor per event. Off/Pixel has none.
2. **Title + path stacked** — bold title, mono `/camelphatlondon` path directly underneath. Two-line rich rows.
3. **Icon action buttons** — Eye (preview) / Pencil (edit) / Copy (link) / Chart (analytics) / Trash (delete). Cleaner than text buttons.
4. **Search + sort + hide-past filters** at top of list.
5. **Rich column set** — Type, Organisation, Registrations, **Waiting List**, Event Date, Created (7 columns vs our 5).
6. **Pagination** — "Rows per page 10" + "1-4 of 4" — proper table controls.

### Fans page (biggest gap vs current)
7. **Analytics-first layout** — 4 metric cards + line chart + geo panel BEFORE the individual list. Even at scale (10,989 fans), this is what a user hits first.
8. **Country breakdown with counts + percentages** — UK 9,964 (91%), US 138 (1%), Ireland 137 (1%)…
9. **Fan Growth chart** with axis + point labels, 30d default.
10. **Time range picker** — Last 30 days default, expandable.
11. **Multi-org selector** — "Select Organisation" dropdown at top (defer to Sprint 5, not MVP need).

### Left nav structure
12. **Three-section sidebar** — NAVIGATION / ESSENTIALS (integration quick-launches) / ACCOUNT.
13. **Upgrade upsell** anchored at bottom.

---

## What Co:brand does better (from memory)

### Fan intelligence layer
14. **Behavioral fan segmentation** — dynamic filters on behavior + attributes; save as named Segments.
15. **Sortable Followers column** — per-fan social follower count from IG/TikTok APIs.
16. **Visual rule builder** for Message Fans — WYSIWYG audience builder with live cost preview.
17. **Compact multi-signup layout** — for tour-style events, stack N signup pages tightly.

---

## What Off/Pixel already gets right

- **Sidebar mono font** — matches LP typography exactly. Insider signal to industry.
- **Cleaner 5-section IA** (Dashboard / Pages / Fans / Insights / Integrations / Settings) vs Evntree's fragmented 8+ items.
- **Insights includes Meta Pixel health section** — Evntree doesn't. This is a genuine differentiator.
- **Settings brand-identity form is comprehensive** — box_logo, wordmark toggle, brand_color, privacy URL, brand socials, attribution toggle all in one page.
- **Integrations cards** are cleaner than Evntree's ESSENTIALS quick-launch chips.
- **Overnight architecture** — sequential-merge shipped 10 PRs in ~8h, code is well-structured.

---

## Where Off/Pixel falls short

### Aesthetic pivot (highest leverage)

**Color palette**
- **Current:** peachy/beige throughout (client's brand color leaking into shell chrome).
- **Target:** pure white (#FFFFFF) shell bg + client-brand-color accent ONLY on primary buttons + status pills. Content stays black on white.
- **Rationale:** matches Supreme's white + red-box-only discipline. Also lets each client's brand color pop without dominating the whole workspace.

**Border-radius**
- **Current:** cards + inputs have 8-12px rounded corners. Reads soft/startup.
- **Target:** **zero radius everywhere** except the sidebar box-logo (which mirrors the client's LP box-logo). Matches LP.

**Typography**
- **Current:** sidebar mono is correct. Body copy mixes sans-serif + mono inconsistently.
- **Target:**
  - Headers → **Futura Bold Italic** (matches LP box-logo font)
  - Body + labels + numeric → **ui-monospace** stack (matches LP)
  - Section titles → **uppercase mono 11px letter-spacing 1.5px** (matches LP countdown header)
- **Result:** unified typographic system across LP + dashboard — same product language.

**Borders + hairlines**
- **Current:** 1px soft grey borders on cards.
- **Target:** **0.5px black hairlines** matching LP form-input pattern. No card containers on the dashboard — sections separated by hairlines only.

**Product identity in sidebar**
- **Current:** "GMC WORLDWIDE PRODUCTIO..." truncated at top, "LANDING PAGES & FANS" as boilerplate subtitle.
- **Target:** **Product wordmark** (OP909 or chosen name) top-left in Futura Bold Italic. Below in mono: "for GMC Worldwide Productions" (small, muted). Separates product from tenant.

### UX gaps per Matas's explicit asks

**Pages list — title clickable + path copy-to-clipboard**
- Title becomes primary link → routes to Edit page.
- Path shown BELOW title in mono 11px muted colour: `/l/gmc-worldwide-productions/jackies-…-wlf8br`.
- **Clicking the path copies the full fan-facing URL to clipboard** (e.g. `https://app.offpixel.co.uk/l/gmc-worldwide-productions/jackies-…-wlf8br` — will become `https://op909.com/l/…` after domain move).
- Transient inline "Copied" indicator (2s fade) on successful copy.

**Pages list — artwork thumbnails**
- 48×48 square, no radius, object-fit cover.
- Falls back to a solid brand-color square with `box_logo_text` in white Futura Bold Italic if no artwork uploaded.

**Pages list — icon action buttons**
- Replace text ("Edit / Preview / Delete") with lucide icons at 16px:
  - Pencil → Edit
  - Eye → Preview (opens /l/ in new tab)
  - Copy → Copy URL
  - BarChart → Insights (per-page analytics)
  - Trash2 → Delete (soft, with confirm dialog)

**Fans page — analytics-first layout**
- Even at 0 signups, show the full analytics scaffold. Empty states are placeholders inside the same layout.
- Order: 4 metric cards → Fan Growth chart → Top Locations panel → filter row → individual fans table.
- Reasoning: matches Evntree pattern, makes the page feel intentional not empty.

**Fans page — geo tagging**
- Country column with ISO-2 code + full country name — e.g. "GB · United Kingdom".
- **No emoji flags** — Supreme discipline holds even on the dashboard side.
- City column populated from `geo_city` when available.
- Country filter + country breakdown in the Top Locations panel drive off the same data.

**Fan detail view (new route)**
- `/admin/{slug}/fans/{signup_id}` — page not currently in scope.
- Content:
  - Full fan attribution (fbc, fbp, referrer URL, geo, IP-derived country/region/city)
  - Signup timestamp + which page they signed up from
  - Consent history (marketing consent, partner consent if enabled)
  - Meta Pixel event log for this signup (PageView → CompleteRegistration correlation)
  - Delete + anonymize actions

**Dashboard home — richer signal**
- Currently: 3 metric cards + pages list.
- Add:
  - **Recent signups feed** (last 10 rows with time + page + country)
  - **Pixel health warning** if CAPI hasn't fired in > 24h and there's an active LP with pixel configured
  - **Next presale countdown** (from earliest `presale_at` across all live pages, matches LP countdown block style)

### Missing features (borrowed from Co:brand — deferred)

- **Sortable Followers column** — once we start fetching IG/TikTok follower counts via a cron (P4)
- **Segments** — save filter combinations as named audiences (P3)
- **Message Fans composer** — broadcast via Bird / Mailchimp to a Segment with cost preview (P5, after CRM push PR)

---

## The aesthetic pivot in detail

**Current state (visual audit):**
- Sidebar: mono type, colored box logo, muted greys — mostly correct.
- Main content: warm beige bg (#F4E9D8-ish), white cards, 1px soft borders, 8-12px radius on cards + inputs.

**Target state (Supreme × Apple):**

| Element | Current | Target |
|---|---|---|
| Shell bg | Beige | Pure white (#FFFFFF) |
| Container radius | 8-12px | 0 |
| Border weight | 1px soft grey | 0.5px black |
| Card containers | Elevated cards | No cards — hairlines only |
| Primary button | Rounded black | Solid black rect, no radius, mono lowercase |
| Secondary button | Rounded outlined | 0.5px black outline, no radius, mono lowercase |
| Metric card | Card w/ label + big number | No card — label above (uppercase mono 10px letter-spacing 1.5px), Futura Bold Italic 32px number in accent |
| Status pill | Small colored pill (keep) | Same — small colored pill is Supreme-approved (their "new" badges) |
| Table row | Zebra + soft border | 0.5px black hairline between rows, no zebra, mono 12px cells, 14px vertical padding |
| Hover state | Bg color change | Text color/underline change only |
| Focus state | Ring | 1px accent color outline |
| Sidebar | Mono + box logo (good) | Same, but fix name truncation + swap subtitle for product wordmark |

**Font stack (aligned with LP):**
```css
--font-sans: system-ui default (kept for form input readability only)
--font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, 'Courier New', monospace
--font-heading: 'Futura', 'Trebuchet MS', 'Helvetica Neue', sans-serif; font-weight: 900; font-style: italic
```

---

## Prioritized Sprint Plan

### Sprint 1 — Aesthetic pivot + Matas's core UX asks (4-6h Cursor, P0)
- Pure white bg + zero radius + 0.5px hairlines throughout
- Kill card containers; use hairline sections instead
- Pages list: clickable title, mono path, copy-to-clipboard, thumbnails, icon actions
- Sidebar: fix truncation, swap "LANDING PAGES & FANS" for standalone product wordmark, remove "Powered by Off/Pixel"
- Metric cards: no bg, no border, mono label + Futura Bold Italic number

### Sprint 2 — Analytics-first Fans + fan detail (6-8h Cursor, P1)
- Fans page: metric cards + chart + geo panel above table
- Country column with ISO code + full name (no emoji)
- Fan Growth line chart (30d default, time range picker)
- Top Locations panel with count + %
- Fan detail view (`/admin/{slug}/fans/{id}`) with full attribution + Pixel event log
- Dashboard home: recent signups feed + pixel health widget + next presale countdown

### Sprint 3 — Behavioral segmentation (6-8h Cursor, P2)
- Sortable columns on Fans list
- Save filter combinations as named Segments
- Signup source tracking (utm params captured on landing page → stored on signup)
- Empty-state polish across all sections

### Sprint 4 — Standalone brand identity (2-3h, waits on Commercial+Ops name lock)
- Rename "Off/Pixel Client Dashboard" → chosen product name (OP909)
- Product wordmark (Futura Bold Italic) at sidebar top
- Login page branding pivot
- Footer attribution swap
- All copy audit for "Off/Pixel"-mentioned strings that should shift to product name

### Sprint 5 — Future (unblocked by CRM push PR #22)
- Message Fans composer with cost preview (Co:brand pattern)
- Behavioral segmentation execution (broadcast to Segments)
- IG/TikTok follower count cron + sortable Followers column
- Multi-brand support (if a second client materially needs it)

---

## Implementation notes

- **react-server test condition landmine still applies** — pin logic at pure-function seams. See `feedback_node_test_react_server_no_dom`.
- **Aesthetic pivot is a CSS-mostly change** — most files unchanged, changes concentrated in globals.css + admin-shell.tsx + a handful of page components.
- **Copy-to-clipboard pattern:** `navigator.clipboard.writeText(url)` with try/catch fallback, 2s transient state.
- **Artwork thumbnails:** lazy-load via next/image, fallback to a solid brand-color square with `box_logo_text` inside (Futura Bold Italic white on brand-color).
- **All changes stay on `/admin/*`** — fan-facing `/l/*` renderer remains locked, no cross-boundary edits.

---

## Files most likely touched (Sprint 1)

- `app/admin/[clientSlug]/pages/page.tsx` — table restructure with new row component
- `components/admin/pages-list-row.tsx` — NEW: encapsulates title/path/thumbnail/actions
- `components/admin/copy-path-button.tsx` — NEW: transient-state clipboard button
- `components/admin/admin-shell.tsx` — sidebar aesthetic pivot + wordmark swap
- `app/admin/[clientSlug]/layout.tsx` — main content bg + spacing tokens
- `app/globals.css` — Futura + mono font stack + shared token vars (probably reuse LP tokens where possible)
- `components/admin/metric-card.tsx` — reshape from card to bordered/hairline section

Roughly 7 files, well-scoped. Sprint 1 is a tight single PR.

---

## One question worth flagging: multi-org support

Evntree lets a user pick between multiple organisations. Off/Pixel's admin is single-tenant per user (single-user MVP per overnight brief). If a client has multiple brand-associated properties (e.g. Jackies runs multiple event series under different sub-brands), do we need multi-org support OR does that get modeled as multiple LPs under one `client_id`?

**Recommendation:** keep single-tenant. Multiple LPs under one client covers 95% of cases. Multi-org adds complexity we don't need MVP.
