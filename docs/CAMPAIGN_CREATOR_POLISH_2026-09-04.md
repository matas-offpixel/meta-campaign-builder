# Campaign creator — PR 8: visual polish

**Date:** 2026-09-04 · **Consumes:** `docs/CAMPAIGN_CREATOR_REDESIGN_2026-09-04.md` (shipped as #876–#883), `lib/viz/tokens.ts`, `app/globals.css` (`:root`), `components/viz/*` (20 primitives).

**Scope:** tokens and scale. No zone, tab or anchor moves. No new primitive. Every change is a value in `lib/viz/tokens.ts` or a class in `components/viz/*` plus the four canvas zone files that consume them.

**Standing rules carried forward:** icon over text · numbers are the hierarchy · colour = platform identity **or** above/below your own benchmark, nothing else · honest empties (dashed, never blank, never zero) · no standing sentences · a 10-year-old can name every control from its glyph plus one word.

---

## 0. Why it reads flat — the four root causes

| # | Cause | Evidence in source |
|---|---|---|
| 1 | **There is no type scale.** Five ad-hoc sizes (`text-[9px]`, `text-[10px]`, `text-[11px]`, `text-sm`, `text-2xl`) chosen per call site. 11px is doing the work of both body and label, so nothing is subordinate to anything. | `channel-row.tsx` facts `text-[11px]`; `provenance-badge.tsx` `text-[9px]`; `metric-chip.tsx` `lg: text-2xl` |
| 2 | **Every zone has the same gutter.** `plan-workspace.tsx` root is `space-y-5` for all seven zones, so the eye gets no grouping and the canvas ends at ~35% of the viewport. | `components/plan/plan-workspace.tsx:712` |
| 3 | **Colour is decoration in two places.** `VIZ_PLATFORM_BAR` is raw Tailwind `sky-500 / fuchsia-500 / amber-500` — off-palette against sand, and `amber-500` collides with `--warning #b8923e`. `VIZ_PROVENANCE_TOKEN` spends five hues (sky, emerald, amber, violet, slate) on badges that carry no colour meaning at all. | `lib/viz/tokens.ts:53`, `:83` |
| 4 | **Ids and ISO strings leak to the surface.** `identityChipDisplay` returns the raw value; the details `schedule` row concatenates ISO. | `lib/plan/identity-chips.ts:63`; details `schedule` row |

Cause 3 is a **constraint violation already in the tree**, not just ugliness: under "colour = platform identity or benchmark, nothing else", provenance badges must be monochrome. Fixing that is what frees a hue for Google (§3).

---

## 1. Type scale — four sizes, named

Add to `lib/viz/tokens.ts`. These are the only text classes any `components/viz/*` file or canvas zone may use.

```ts
/**
 * Four sizes, and only four. `display` is reserved for the one big
 * number a zone exists to answer — budget, target, and a LIVE
 * cost-per-stage. Anything else at display size destroys the hierarchy
 * it is there to create.
 */
export const VIZ_TYPE = {
  display: "text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums",
  body:    "text-[14px] font-normal leading-[1.35]",
  label:   "text-[12px] font-medium leading-[1.25] tracking-[0.01em]",
  micro:   "text-[10px] font-medium uppercase leading-none tracking-[0.08em]",
} as const;

/** Same sizes with tabular figures — every numeric read. */
export const VIZ_TYPE_NUM = {
  body:  `${VIZ_TYPE.body} tabular-nums`,
  label: `${VIZ_TYPE.label} tabular-nums`,
  micro: `${VIZ_TYPE.micro} tabular-nums`,
} as const;
```

### Token table

| Token | px | Weight | Tracking | Case | Tabular | Gets it |
|---|---|---|---|---|---|---|
| `display` | 32 | 600 | −0.02em | as-typed | **yes** | Zone C budget number (`£40`), zone D target number (`£0.35`), LIVE cost-per-stage in `ChannelRow` |
| `body` | 14 | 400 | 0 | sentence | on numerics | `ChannelRow` facts, blocker rows, details values, drawer form fields and labels, decisions-sheet rows, `SplitBar` segment %, `WindowBar` handle labels, identity chip names |
| `label` | 12 | 500 | +0.01em | sentence | on numerics | zone labels, drawer tab labels, target unit segmented control, `open ▸` / `edit ▸` / `resume ▷`, buttons, `SplitBar` preset chips, identity chip field names, audiences row nouns |
| `micro` | 10 | 500 | +0.08em | UPPER | on numerics | `ProvenanceBadge` mark, `BlockerBadge` count, relative time (`in 29d`, `2h`), aspect chips, count bubbles |

**Rule:** `micro` is the floor. Nothing renders below 10px, and nothing that is a *value* renders at `micro` — micro is metadata about a value.

**Rejected:** `--font-heading` (Bebas Neue) for `display`. It is a condensed display face with no tabular figure set, and every display number is a currency read that must not jitter as digits change. Display stays `--font-sans` at 600.

### Migration map (mechanical)

| Current | Becomes | Files |
|---|---|---|
| `text-[9px]` | `VIZ_TYPE.micro` | `provenance-badge.tsx` |
| `text-[10px]` on a value | `VIZ_TYPE_NUM.body` | `window-bar.tsx` moment labels, `canvas-target.tsx` unit chips, `canvas-budget.tsx` mode chips |
| `text-[10px]` on metadata | `VIZ_TYPE_NUM.micro` | `blocker-badge.tsx` count, `window-bar.tsx` relative label, `split-bar.tsx` preset chips → but see §4 (they stop being text) |
| `text-[11px]` on a fact | `VIZ_TYPE_NUM.body` | `channel-row.tsx:70`, `decisions-sheet.tsx:202`, details `<dd>` |
| `text-[11px]` on a control | `VIZ_TYPE.label` | `channel-row.tsx:87` `open ▸`, drawer header controls, `drawer.tsx` tabs |
| `text-sm` | `VIZ_TYPE.body` | `funnel-stage-bar.tsx:63` |
| `text-2xl font-semibold` (`MetricChip` `lg`) | `VIZ_TYPE.display` | `metric-chip.tsx:6` |

---

## 2. Spacing and canvas height

Target viewport **1372 × 883**. App chrome above the canvas is ~72px, leaving 811px. The canvas must fill 620–700px of it and never scroll.

### Zone heights and gutters

Replace `plan-workspace.tsx`'s uniform `space-y-5` with explicit per-zone gutters. Grouping is the point: **B/C/D are the three inputs and sit tight together; E is the state block and gets air above and below it.**

| Zone | Content | Height | Gutter below |
|---|---|---|---|
| **A** header | thumb 40 + name (`body`) + meta row + chip row | 88 | **20** |
| **B** window | `WindowBar` 40 + labelled handles | 64 | **16** |
| **C** budget | `display` number + mode chips + lifetime read | 80 | **16** |
| **D** target | `display` number + unit segmented control + `⌁ preset` | 80 | **24** |
| **E** channels | 3 × `ChannelRow` @ 40 | 120 | **20** |
| **F** assets | `AssetStrip` thumbs 48 + routing line | 72 | **24** |
| **G** launch | one button, right-aligned | 48 | — |

```
content 88+64+80+80+120+72+48 = 552
gutters   20+16+16+24+20+24    = 120
canvas                          = 672px  (76% of 883; 83% of the 811 available)
```

Launch lands at **y ≈ 744** of 883 — bottom-right of the content block, on the first screen, with ~140px of sand below it. Up from ~35% fill.

```ts
export const VIZ_ZONE_GUTTER = {
  tight:  "mt-4",  // 16 — between the three inputs (B→C, C→D)
  normal: "mt-5",  // 20 — A→B, D→E … E→F
  loose:  "mt-6",  // 24 — around the state block (D→E, F→G)
} as const;
```

Implementation: drop `space-y-5` on the root; each zone `<section>` carries its own `mt-*`. Zone A carries none.

---

## 3. Platform tints in the sand palette

Sand is warm and light: `--background #F0C9A8`, `--card #e8d4c0`, `--surface #e0cdb8`, ink `--foreground #1e1810`. The semantic colours already spend three hues — `--success #6b8f5e` (olive), `--warning #b8923e` (ochre), `--destructive #a0453a` (brick).

**Google has no free brand hue.** Its blue collides with Meta, its red with `--destructive`, its yellow with `--warning` *and* with sand itself, its green with `--success`. So Google takes a muted violet, identity comes from hue separation plus the glyph, and the freed collision is resolved by taking violet off `VIZ_PROVENANCE_TOKEN` (§0 cause 3) in the same PR.

### Tints

All three at **L 60–62, S 30–35%** so no platform reads louder than the others, and all three carry ink labels at ≥ 4.5:1.

| Platform | Fill (bars, segments) | HSL | Ink on fill | Glyph ink (on sand) | Glyph vs sand | Fill vs sand |
|---|---|---|---|---|---|---|
| `meta` `f` | **`#759FBD`** dusty blue | 205 · 35% · 60% | **6.24:1** | **`#3F6783`** | **3.92:1** | 1.83:1 |
| `tiktok` `♪` | **`#BE7E9E`** muted rose | 330 · 33% · 62% | **5.59:1** | **`#884466`** | **4.44:1** | 2.04:1 |
| `google` `G` | **`#9E7AB8`** muted violet | 275 · 30% · 60% | **4.97:1** | **`#66447E`** | **5.06:1** | 2.30:1 |

Every ratio above is measured, not estimated. Hue gaps: 205 → 275 → 330, i.e. 70° and 55° apart, and none within 40° of olive/ochre/brick.

**Read the last column before writing §4.** Fill-vs-sand is 1.8–2.3:1 — that is the cost of 30–35% saturation in a warm light palette, and it means **a tint fill must never be the only thing separating a segment from the page.** So the `SplitBar` track keeps a `bg-foreground/[0.06]` background and a `border border-border` hairline (§4), the segment boundary is tint-vs-muted rather than tint-vs-sand, and every percentage is stated in ink text as well as in width. Ink-on-fill clears 4.5:1 on all three, which is what makes an in-segment label legal.

```ts
/**
 * Platform identity — the ONE decorative use of colour left on the
 * canvas, and only on PlatformGlyph, SplitBar segments and the
 * ChannelRow glyph. 30–35% saturation so three tints sit in the sand
 * palette without shouting; L 60–62 so an ink label on a fill clears
 * 4.5:1. Google's brand quadcolour is unusable here — each of its four
 * collides with sand, --warning, --success or --destructive — so its
 * identity is the glyph plus a hue nobody else holds.
 */
export const VIZ_PLATFORM_BAR: Record<VizPlatform, string> = {
  meta: "bg-[#759FBD]",
  tiktok: "bg-[#BE7E9E]",
  google: "bg-[#9E7AB8]",
};

/** Darker same-hue for a 1.6px glyph stroke on sand (≥ 3:1 as a graphic). */
export const VIZ_PLATFORM_INK: Record<VizPlatform, string> = {
  meta: "text-[#3F6783]",
  tiktok: "text-[#884466]",
  google: "text-[#66447E]",
};

/** In-segment labels sit on the fill, so they are ink — never sand. */
export const VIZ_ON_PLATFORM_INK = "text-[#1e1810]";
```

### Provenance goes monochrome (required by the constraint)

```ts
export const VIZ_PROVENANCE_TOKEN: Record<VizProvenance, string> = {
  "platform-reported": "bg-foreground/10 text-foreground/70",
  "first-party":       "bg-foreground/10 text-foreground/70",
  "manual entry":      "bg-foreground/[0.06] text-foreground/60",
  modelled:            "bg-foreground/[0.06] text-foreground/60",
  derived:             "bg-foreground/[0.06] text-foreground/60",
  "industry seed":     "bg-transparent text-foreground/50 border border-border",
  "not instrumented":  "border border-dashed border-border bg-transparent text-muted-foreground",
};
```

The mark (`plat` `1P` `man` `mod` `⌁` `seed` `—`) already carries the distinction; `VIZ_PROVENANCE_MARK` is unchanged. Dark mode needs no tint variants — `.dark` in `globals.css` overrides exactly one variable today, so there is no second palette to serve.

**Everything not in the two maps above stays sand/ink.** `StatusDot` keeps `--success`/`--warning`/`--destructive` because status *is* the benchmark axis. `ThresholdBand` keeps its zone tokens for the same reason.

---

## 4. `SplitBar`

Colour currently full-bleed at `h-6` with the legend orphaned underneath at 11px, and the presets are text.

```
BEFORE                                       AFTER
                              SEED ⓘ                                       seed ⓘ
┌───────────────────────────────────────┐    ┌──────────────────┐ ┌────────┐ ┌────┐
│███████████████│██████████│███████████│    │ f 63%            │ │ ♪ 25%  │ │    │◄ G 13%
└───────────────────────────────────────┘    └──────────────────┘ └────────┘ └────┘
 f 63  ♪ 25  G 13   [50/30/20] [equal]        [▟▖▖] [▄▄▄] [▙▂▂]
 └ 11px, below the bar, colour = decor         └ preset = bar shape, not words
```

| Property | Value |
|---|---|
| Track height | **`h-2.5`** (10px) — the bar states a ratio; it is not the hero |
| Track | `bg-foreground/[0.06]` + `border border-border`, `rounded-sm`, `overflow-hidden` — **not** transparent (§3: fill-vs-sand is only 1.8:1, so the track carries the edge) |
| Segment gap | **2px** between segments (`gap-[2px]` on the flex row), showing the muted track through, so adjacency contrast is tint-vs-muted rather than tint-vs-tint |
| Radius | `rounded-sm` per segment |
| Legend ≥ 12% | **inside** the segment: `PlatformGlyph size="sm"` + `{pct}%` at `VIZ_TYPE_NUM.body` in `VIZ_ON_PLATFORM_INK`, `px-1.5` |
| Legend < 12% | **outside**, right of the bar, in source order: `◄ G 13%` at `VIZ_TYPE_NUM.body`, glyph in `VIZ_PLATFORM_INK` |
| Bar row height | **28px** so an inside label fits without growing the fill (label is absolutely positioned, vertically centred on the 10px fill) |
| Preset chips | **bar-shaped icons**, not text: a 16×10 three-segment mini-bar drawn with the same `VIZ_PLATFORM_BAR` fills at the preset's ratio. `aria-label` and `title` carry the words (`"50/30/20"`, `"equal"`). `VIZ_TYPE.label` only for a preset with no expressible shape |
| Boundary handles | unchanged behaviour; hit area widens `w-2` → **`w-3`**, visual is a 2px ink rule at 60% opacity centred on the boundary |
| Provenance | badge moves **left of the bar** on the same baseline as the legend, `micro` |

`FunnelBarSegments` is the shared track and keeps its contract — it gains the 2px gap and the optional in-segment label slot, and `FunnelStageBar` inherits both.

---

## 5. `WindowBar`

Currently a `h-px` hairline in a `h-8` box; the start handle sits at the far left unlabelled; moments vanish silently when the event has none.

```
BEFORE
        ⓘ
  ●─────────────────────────────────────────────────●
  ◐          ▲                      ★
  now       show                  in 29d
  └ 9px, handles unlabelled, no presale row at all

AFTER
                                                                    ⓘ
        ◐ now              ⊙ presale            ★ gen sale
        │                  ┆ not set             │
  ├●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●┤
  start                                                       end
  Wed 26 Aug · 22:00                            Sun 6 Sep · 23:00 · in 29d
```

| Property | Value |
|---|---|
| Row height | **`h-16`** (64px): moment lane 20px · rail 12px · handle-label lane 32px |
| Rail | **`h-1`** `bg-foreground/10` `rounded-full`, full width |
| Active span | **`h-1`** `bg-foreground/45`, `rounded-full`, start→end |
| Handle glyph | `▐` bracket, not a disc: **`h-4 w-[3px]`** ink bar with a 12px transparent hit pad each side; `aria-pressed` on drag, ring on focus |
| Handle label | **always rendered**, below the handle, `VIZ_TYPE_NUM.body`: `start` / `end` at `VIZ_TYPE.label` on the line above, then `formatVizMoment(at)` (§8). Start label left-aligned to the handle, end label right-aligned, so neither clips at 0% / 100% |
| Relative | `· in 29d` appended to the **end** label only, `VIZ_TYPE_NUM.micro`. Never on `start` — two relative reads on one bar is noise |
| Moment glyph | `◐ now` · `⊙ presale` · `★ gen sale` · `▲ show`, glyph `VIZ_TYPE.body`, noun `VIZ_TYPE.label`, both ink at 70% |
| **Missing moment** | **dashed placeholder, never absent**: the glyph at 35% opacity, a `border-l border-dashed border-border` 12px tick, the noun, and `InfoTip` reading *"this event has no presale time set — add it on the event to snap the window to it"*. Position: proportionally between the moments that do exist, or at 33%/66% when neither neighbour exists |
| Clamped state | `data-state="clamped"` already set; add a 2px `--warning` inner ring on the rail for 400ms. No copy |

---

## 6. Identity chips

Seven raw ids in a row is the single worst read on the canvas. Same seven chips, same order — the id moves into the `InfoTip` and a name takes its place.

```
BEFORE
 f act_1967530076312  f 33782234934753151  f 1157874844068425  f 17841446090086018
 ♪ 7639802149165301776   ♪ f5096207-c327-4a6b-…   G 324-410-8450

AFTER
 f Ironworks Ads ⓘ   f Ironworks Pixel ⓘ   f Ironworks ⓘ   f @ironworks.uk ⓘ
 ♪ Ironworks LTD ⓘ   ♪ @ironworksclub ⓘ    G Ironworks — 324-410-8450 ⓘ
 ┄ pixel not set                                    ← dashed, never blank
```

| Property | Value |
|---|---|
| Shape | glyph-first: `PlatformGlyph size="sm"` in `VIZ_PLATFORM_INK` · name · `InfoTip` |
| Name | `VIZ_TYPE.body`, `max-w-[11rem] truncate` |
| Field name | dropped from the visible chip — it is in the `InfoTip` and the `aria-label`. Four `f` chips in a row are distinguished by their names, not by the words "ad account / pixel / page / ig" |
| `InfoTip` copy | `{field} · {name} · {id} · {provenance}` — e.g. `ad account · Ironworks Ads · act_1967530076312 · client default` |
| Provenance | `StatusDot` stays (`live` = operator override, `ready` = client default) — status, not decoration |
| **Unresolved id** | while the name request is in flight, show the **id** at `VIZ_TYPE_NUM.body` `opacity-60`, then swap. Never a spinner, never blank |
| **Missing** | `┄ {field} not set` — dashed border chip (`border border-dashed border-border`), `VIZ_TYPE.label`, `text-muted-foreground`, links to `/clients/[id]`. Never omitted |
| Google chip | name **and** customer id, because the id *is* how an operator recognises a Google account: `Ironworks — 324-410-8450` |

### Name sources (already in the tree — no new endpoint)

| Chip | Source |
|---|---|
| Meta ad account | `GET /api/meta/ad-accounts` → `name` |
| Meta pixel | `GET /api/meta/pixels` → `name` |
| Meta page | `useFetchPages(adAccountId)` → `name` |
| Meta IG | `GET /api/meta/instagram-accounts` → `username`, rendered `@handle` |
| TikTok advertiser | `GET /api/tiktok/accounts` → advertiser name |
| TikTok identity | `GET /api/tiktok/identities` → `display_name`, rendered `@handle` |
| Google customer | `wizardContext.googleAdsAccounts` → `account_name` (already threaded, #883) |

`identityChipDisplay(value)` becomes `identityChipDisplay(value, name)`: name → id → `null`. `null` renders the dashed chip. `lib/plan/identity-chips.ts` gains a `name: string | null` field on `PlanIdentityChip`; the resolver stays pure and the fetching stays in `plan-identity-chips.tsx`.

---

## 7. Target — segmented control

```
BEFORE                                    AFTER
 ◎ £0.35 / lpv  SEED ⓘ                     ◎ £0.35 / lpv    seed  ⓘ   ⌁ preset · edit
 reg click lpv purchase view ⓘ            ┌──────┬───────┬──────┬──────────┬──────┐
 └ 9px text chips, no container            │⊕ reg │↗ click│▢ lpv │◆ purchase│◉ view│
                                           └──────┴───────┴──────┴──────────┴──────┘
                                            └ one container, 12px, glyph + word
```

| Property | Value |
|---|---|
| Container | one `rounded-md border border-border bg-muted/40 p-[2px] inline-flex`, `role="radiogroup"` |
| Segment | `VIZ_TYPE.label`, `px-2.5 py-1`, glyph + word, `aria-checked` |
| Selected | `bg-foreground text-background rounded-[4px]`, `shadow-sm` |
| Unselected | `text-muted-foreground hover:text-foreground`, no border (the container owns the frame) |
| Glyphs | `⊕ reg` · `↗ click` · `▢ lpv` · `◆ purchase` · `◉ view` — the glyph distinguishes, the word carries the meaning, both at label size |
| Deselect | clicking the selected segment still clears the unit (unchanged behaviour) — `InfoTip` keeps `PLAN_CANVAS_COPY.unitChangesObjective` |
| Number | `MetricChip size="lg"` → `VIZ_TYPE.display` (32px). `◎` prefix and `/ lpv` suffix at `VIZ_TYPE.label`, `text-muted-foreground`, baseline-aligned to the display digits |
| Seed badge | `micro`, but on the **monochrome** `industry seed` token (§3): transparent fill, `border border-border`, `text-foreground/50`. Legible because it is 10px/500 with 0.08em tracking on sand, not because it is coloured |
| Objective select | no-unit state only, unchanged; grows to `VIZ_TYPE.label` |

Same treatment for `canvas-budget.tsx`'s `[daily] [lifetime]` pair — one segmented container, `VIZ_TYPE.label`.

---

## 8. Dates — one formatter

No ISO string reaches any surface an operator reads. Two formatters already exist and neither can serve: `lib/library/format-date.ts` passes no `timeZone` (renders in server-local), and `lib/landing-pages/format-datetime.ts` is fan-facing with a doc comment that explicitly forbids unifying it with other contexts.

Add to `lib/viz/tokens.ts` (the one non-component file this PR may touch):

```ts
/**
 * "Fri 6 Sep · 23:00", Europe/London, always. This is a UK agency and
 * every plan window, moment and schedule row is read in London time.
 * Deliberately NOT shared with lib/landing-pages/format-datetime.ts —
 * that module is fan-facing and its formats are copy-locked.
 */
export function formatVizMoment(iso: string | Date): string;   // "Fri 6 Sep · 23:00"
export function formatVizDay(iso: string | Date): string;      // "Fri 6 Sep"
export function formatVizRelative(iso: string | Date, now?: Date): string; // "in 29d" · "2h ago" · "now"
```

`Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London" }).formatToParts` for the weekday, day and time, joined by `" · "`. Invalid input returns `"—"`, never the input string.

**The month must not come from `Intl`.** `en-GB` with `month: "short"` renders September as **`"Sept"`**, not `"Sep"` — measured, not assumed:

```
en-GB  Jan Feb Mar Apr May Jun Jul Aug Sept Oct Nov Dec
en-US  Jan Feb Mar Apr May Jun Jul Aug Sep  Oct Nov Dec
```

A four-character month in one of twelve breaks column alignment on the `WindowBar` end label and the details schedule row, and the spec is literally `"Fri 6 Sep · 23:00"`. So the month comes from a fixed table indexed off the `Intl` London month number — not from `en-US`, which would silently reintroduce US ordering if anyone later widens the options:

```ts
const VIZ_MONTH = ["Jan","Feb","Mar","Apr","May","Jun",
                   "Jul","Aug","Sep","Oct","Nov","Dec"] as const;
```

**And the day must be re-numbered.** Asking for `day: "numeric"` alongside `hour: "2-digit"` in the same `formatToParts` call returns a **zero-padded** day — `"Sun 06 Sep · 23:00"`, measured. Coerce it: `Number(parts.day)`. Both quirks are why this is one formatter with one guard test, not an inline `toLocaleString` per call site.

> Aside, out of scope: `formatEventDateShort` in `lib/landing-pages/format-datetime.ts` has the same `en-GB` `month: "short"` call, so fan-facing September events currently render `"Sept"`. That module is copy-locked — raise it separately rather than touching it here.

### Call sites

| Where | Before | After |
|---|---|---|
| Details `schedule` row | `2026-08-26T21:00:00Z → 2026-09-06T23:00:00Z` | `Wed 26 Aug · 22:00 → Sun 6 Sep · 23:00` |
| `WindowBar` handle labels | (none) | `formatVizMoment` |
| `WindowBar` relative | `relativeMomentLabel` | `formatVizRelative` |
| Zone A event date | `formatLibraryDate` | `formatVizDay` |
| Details `timezone` row | `Europe/London` | unchanged — this row *is* the timezone |
| Decisions sheet row time | `2h` | unchanged (`formatVizRelative` produces the same) |

Guard test: no `components/viz/*`, `components/plan/*` or drawer-mounted source may match `/\d{4}-\d{2}-\d{2}T/` in JSX.

---

## 9. Drawer interiors

### 9a. Audiences — five tabs become five rows

Per redesign §3a, a drawer tab is a judgement; the five audience **sources** are not five judgements, they are five collections inside one. The five-tab strip is also a `components/ui/tabs.tsx` import, which this PR may not restyle — so it is replaced at the call site in `audiences-step.tsx`, not edited.

```
BEFORE
┌────────────────────────────────────────────────────────────────┐
│ Page Audiences 2 │ Custom Audiences 0 │ Custom (Off/Pixel) 0 │…│  ← overflows to "Ir… C"
└────────────────────────────────────────────────────────────────┘

AFTER
 ▦  pages          2 groups · 14 pages          edit ▸
 ◨  custom         —                            edit ▸
 ◫  off/pixel      —                            edit ▸
 ◇  saved          1                            edit ▸
 ✳  interests      3 groups · 22 interests      edit ▸
```

| Property | Value |
|---|---|
| Row | `40px`, `flex items-center gap-2`, `border-b border-border` except the last |
| Glyph | `VIZ_TYPE.body`, `text-foreground/70`, fixed `w-5` so the nouns align |
| Noun | `VIZ_TYPE.label`, one word |
| Count | `VIZ_TYPE_NUM.body`, `ml-auto mr-3`; zero renders **`—`**, not `0` (honest empty) |
| Handle | `edit ▸` at `VIZ_TYPE.label`, `text-muted-foreground hover:text-foreground` |
| Open | clicking the row expands the panel **in place** below it and collapses the other four. `activeTab` state, `AudienceTab` union and `initialAudienceTab()` are all unchanged — this is the same state machine with a row list instead of a tab strip |
| Selected row | `bg-muted/40`, glyph and noun to full ink |

### 9b. Creatives — single column, asset slot as hero

`surface="drawer"` already forces `grid-cols-1` (#883). What is missing is order and scale.

```
BEFORE (drawer, single column)          AFTER
 [Ad 1 ▾]                                [Ad 1 ▾]        ▤ 2 assets · 4:5 9:16
 Source: ○ new ● existing                ┌──────────┐ ┌──────────┐
 Facebook Page  [Ironworks     ▾]        │  4:5     │ │  9:16    │   ← 160px tall
 Instagram      [@ironworks.uk ▾]        │  ▣       │ │  ▣       │
 Primary text   [___________________]    └──────────┘ └──────────┘
 Headline       [___________________]    primary text
 Description    [___________________]    [_____________________________]
 destination ⌁ https://…                 headline            description
 CTA            [Learn more    ▾]        [______________]    [__________]
 ┌────┐ ← 80px asset slot, last                 ⌁ https://ironworks.uk/tickets
 └────┘                                  CTA [Learn more ▾]   ⊞ identity ▸
```

| Property | Value |
|---|---|
| Order | **asset slots first**, then copy, then destination + CTA, then identity as a `▸` disclosure. The asset is the judgement; page/IG are client defaults with a badge (§3a) and do not belong above the fold of the tab |
| Asset slot | **160px** tall (from 80), `max-w-none`, one per row at drawer width; the aspect badge (`AspectChip`) is the label |
| Asset row | `grid-cols-2 gap-3` **only** when the drawer is ≥ 720px wide *and* there are exactly two slots — otherwise stacked. Uses the existing `slots.length === 1 \|\| drawer` branch, extended |
| Copy fields | full width, `VIZ_TYPE.body` |
| Headline + description | side by side (`grid-cols-2`) — both are short and pairing them saves 64px |
| Identity | `⊞ identity ▸` disclosure, collapsed, showing `f Ironworks · @ironworks.uk` with the `⌁` badge when from client defaults |
| Destination | `DestinationBadge` stays; `VIZ_TYPE_NUM.body`, `truncate` |
| Queue-library thumbnails | grid **unchanged** — it is a picker, not a form, and it does not clip |

---

## 10. Decisions sheet

Rows are right. The band is 6px and the rhythm is 11px on `space-y-1.5`.

| Property | Before | After |
|---|---|---|
| `ThresholdBand` `sm` | `h-1.5` (6px) | **`h-2`** (8px) |
| `ThresholdBand` `md` | `h-2.5` | **`h-3`** (12px) — used in details, where it is the read |
| Marker | `h-3 w-3` `border-2` | **`h-3.5 w-3.5`**, `border-2 border-foreground`, `bg-card`, `shadow-sm` — must read on top of a 8px band without covering it |
| Band width | `w-full` | **`min-w-[96px] max-w-[160px]`** — a band wider than its row is a chart, not a gauge |
| Row height | `text-[11px]` on `space-y-1.5` | **`36px`**, `space-y-0` with `border-b border-border` between rows; `VIZ_TYPE_NUM.body` |
| Row columns | wrap | fixed rhythm: `glyph 20 · metric 88 · band 96–160 · value 64 · provenance auto · time 48` |
| Dashed empty | `border-dashed` at `h-1.5` | same at `h-2`; marker omitted, `aria-label="no reads yet"` unchanged |
| Group header | `mb-3 pb-3` | unchanged; label to `VIZ_TYPE.label` |

Colour stays confined to the band zones — that is the benchmark axis and the one legitimate non-identity use of colour on this surface.

---

## Build order — two PRs, both off fresh `main`

### PR 8a · `cursor/viz-tokens-and-scale`

**Tokens, palette and the leaf primitives.** No canvas file, no drawer file, no `lib/plan/*`.

1. `lib/viz/tokens.ts` — add `VIZ_TYPE`, `VIZ_TYPE_NUM`, `VIZ_ZONE_GUTTER`, `VIZ_PLATFORM_INK`, `VIZ_ON_PLATFORM_INK`; replace `VIZ_PLATFORM_BAR` values (§3); replace `VIZ_PROVENANCE_TOKEN` with the monochrome map; add `formatVizMoment` / `formatVizDay` / `formatVizRelative` (§8).
2. `components/viz/` — apply the migration map (§1) and the per-component specs: `platform-glyph.tsx` (ink token), `split-bar.tsx` + `funnel-stage-bar.tsx` (§4), `window-bar.tsx` (§5), `threshold-band.tsx` (§10), `provenance-badge.tsx`, `metric-chip.tsx`, `channel-row.tsx`, `blocker-badge.tsx`, `drawer.tsx` (tab labels only).
3. Guards, extending `lib/viz/__tests__/viz-kit-redesign.test.ts`:
   - every `components/viz/*.tsx` matches only `VIZ_TYPE` / `VIZ_TYPE_NUM` — **zero** raw `text-[Npx]`, `text-sm`, `text-xs`, `text-2xl`;
   - `VIZ_PLATFORM_BAR` and `VIZ_PLATFORM_INK` are the only hex literals in `components/viz/*`, and every value appears in `lib/viz/tokens.ts`;
   - `VIZ_PROVENANCE_TOKEN` contains no `sky-|emerald-|amber-|violet-|slate-`;
   - **contrast is asserted, not asserted-to**: a `wcagContrast(a, b)` helper in the test file checks ink-on-fill ≥ 4.5 and glyph-on-sand ≥ 3.0 for all three platforms against `#F0C9A8` / `#1e1810`. This is what stops a future "let's make the tints prettier" commit from silently making an in-segment label illegible;
   - `formatVizMoment("2026-09-06T22:00:00Z")` === `"Sun 6 Sep · 23:00"` — pins both the BST offset (UTC+1) **and** the `Sep`-not-`Sept` month table;
   - `formatVizMoment("2026-08-26T21:00:00Z")` === `"Wed 26 Aug · 22:00"`;
   - `formatVizMoment("2026-01-06T22:00:00Z")` === `"Tue 6 Jan · 22:00"` — the GMT half of the year, so a hardcoded `+1` cannot pass;
   - `splitBarLegendPlacement(pct)` is `"inside"` at 12 and `"outside"` at 11.9 (pure helper, colocated in `lib/viz/split-bar.ts`).

**Ships alone and is visible**: every canvas and drawer read changes size and the three tints land, because they all consume these primitives.

### PR 8b · `cursor/canvas-zone-rhythm`

**Application at the zone and drawer-interior level.**

1. `plan-workspace.tsx` — drop root `space-y-5`, per-zone `VIZ_ZONE_GUTTER` (§2).
2. `canvas-header.tsx` + `plan-identity-chips.tsx` + `lib/plan/identity-chips.ts` — resolved names, `InfoTip` ids, dashed missing chip (§6).
3. `canvas-target.tsx` + `canvas-budget.tsx` — segmented controls, `display` numbers (§7).
4. `canvas-window.tsx` — labelled handles, dashed missing moments (§5 call site).
5. `meta-drawer-details.tsx` / `tiktok-` / `google-` — `formatVizMoment` on the schedule rows (§8).
6. `audiences-step.tsx` — five rows replacing `<Tabs>` (§9a). **Do not edit `components/ui/tabs.tsx`** — it is shared and other surfaces depend on it.
7. `creatives.tsx` — asset-first order, 160px slots (§9b).
8. `decisions-sheet.tsx` — row rhythm (§10).
9. Guards, extending `lib/plan/__tests__/drawer.test.ts`:
   - no ISO literal in any canvas or drawer-mounted source;
   - `plan-workspace.tsx` has no `space-y-` on the zone root and every zone carries a `VIZ_ZONE_GUTTER` value;
   - the zone height table sums into 620–700 (a pure `planCanvasHeightBudget()` helper in `lib/plan/canvas.ts` so the number is testable, not measured);
   - `audiences-step.tsx` does not import `@/components/ui/tabs`; five rows, five `edit ▸`;
   - identity chips: an unresolved name renders the id, a missing value renders the dashed chip, neither renders empty.

**Order matters:** 8b consumes 8a's tokens. Do not interleave — 8a must be merged before 8b opens, or 8b's guards fail on tokens that do not exist yet.

---

## Two rulings needed before 8a opens

1. **`formatVizMoment` in `lib/viz/tokens.ts`.** The constraint is "`components/viz/*` and `lib/viz/tokens.ts` only", so a formatter goes in a tokens file — which is not what a tokens file is for. The alternative is `lib/viz/format-moment.ts`, a new module (not a new *primitive*). **Recommend the new module**; state the exception explicitly if you want the letter of the constraint instead.
2. **Google's violet.** It is the only hue left (§3) and it costs the monochrome rewrite of `VIZ_PROVENANCE_TOKEN` to avoid colliding with `derived`/`modelled`. That rewrite is required by the colour constraint anyway, so the cost is already owed — but it does mean 8a touches provenance colour on every surface in the app, not just the canvas.
