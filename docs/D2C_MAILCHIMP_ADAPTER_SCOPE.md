# Mailchimp adapter — scope & implementation plan

**Status:** scoping only. Nothing built, nothing in Mailchimp created, modified or deleted.
**Audited:** 2026-07-29, read-only, account `us7` via `resolveMailchimpCredentials`.

Goal: extend the existing brief pipeline (`lib/d2c/`, which already produces Bird
templates + scheduled broadcast drafts) so one brief also produces Mailchimp
drafts — ending the hand-paste of copy blocks into the Mailchimp UI.

---

## 0. Two findings that gate the plan

Both are the STOP conditions named in the brief. Read these before the rest.

### STOP 1 — Customer Journeys cannot be created through the public API

The v3 API root advertises its resources, and **Customer Journeys is not among them**:

```
GET /3.0/?fields=_links →
  lists  reports  conversations  campaigns  automations  templates
  file-manager  authorized-apps  batches  template-folders
  campaign-folders  ecommerce  ping          (all GET)
```

`https://us7.api.mailchimp.com/schema/3.0/CustomerJourneys/Namespace.json` → **404**.

The journey endpoints used in this audit (`/3.0/customer-journeys/journeys`,
`…/{id}/steps`) **do respond 200** but are undocumented internals. The only
*documented* Customer Journeys operation is
`POST /customer-journeys/journeys/{journey_id}/steps/{step_id}/actions/trigger`
— which pushes a contact into a journey that **already exists**. There is no
documented create/update endpoint, and I did not probe for one by POST, because
a speculative write against a live client account is exactly what this task
forbids.

**Classic Automations are not a fallback here:** `GET /3.0/automations` returns
`total_items: 0`. The account uses Journeys exclusively, and Mailchimp has
closed classic Automations to new creation.

→ **Decision needed.** Phase 2 (journeys) cannot proceed as "create via API".
Realistic options in §6.

### STOP 2 — Journey and campaign naming is inconsistent across brands

There is no shared convention to encode. Real names, per audience:

| Brand | Journey names as they exist |
|---|---|
| Throwback | `T26 - LISBOA - MONSANTOS`, `T26-MADRID`, `T26 - PORT - AUTO 2`, `THROW25-NYE AUTO` |
| Jackies | `J26-HALLOWEEN`, `J26-MADRID-28JUNE After`, `Jackies Madrid Autoresponders`, `jackies madrid 2025 autoresponder Copy Copy` |
| KINYXX | `K26-HALLOWEEN`, `KIN26-MADRID AUTORESPONDER`, `KINYXX \| Madrid Fet!sh Halloween Autoresponder` |
| Fury | `FURY26-HALLOWEEN`, `MAD26-RAZZMATAZZ AUTO`, `HEDONIKA launch autoresponder` |
| HOP ON THE TOP | `HOP26-HALLOWEEN ANNOUNCEMENT flow`, `HOP26-BERLIN AUTO ` (trailing space), `HOP26-LISNOA AUTO 2` (typo) |
| The 90s Party | `90s-OPENING-LATERRAZZA Auto`, `Welcome new contacts` |

Prefixes vary within one brand (`T26` / `THROW25`; `K26` / `KIN26` / `KINYXX`;
`HOP26` / `H26`), separators vary (` - ` vs `-`), suffixes vary (`AUTO`,
`AUTORESPONDER`, `flow`, `Auto`, none), and there are trailing spaces and typos.
Campaign titles diverge the same way: `PRESALE - Throwback HALLOWEEN` vs
`HOP26-HALLOWEEN PRESALE` vs `J26-halloween PRESALE`.

→ **Decision needed.** The adapter must emit *one* naming convention. Proposal
in §6, but this is Matas's call, not a technical one.

---

## 1. Current-state audit

### One account, twelve audiences

Account **"Jackies"** (`us7`, 172,175 subscribers, monthly plan) holds every
brand as a separate audience. There is no per-brand account.

| Audience | ID | Members | Journeys |
|---|---|---|---|
| Jackies | `08fe70fa49` | 52,953 | 28 |
| Throwback | `c2b4d77acb` | 34,127 | 18 |
| Fury | `bf1b94dd15` | 33,772 | 18 |
| HOP ON THE TOP | `27eb062177` | 15,611 | 9 |
| KINYXX | `3cbfdc697d` | 8,565 | 13 |
| Afrodanz | `d70fd8a68e` | 3,477 | 5 |
| The 90s Party | `aa8d819989` | 1,682 | 2 |
| HOPE | `5d4ce3919f` | 1,145 | 4 |
| Coffee Morning Dance | `89671d9d97` | 510 | 1 |
| Petardeo | `7e381bfe81` | 430 | 1 |
| Closa Selects | `2bba612878` | 310 | 1 |
| TEST - Kinyxx | `13563ebb0c` | 3 | 0 |

Brands named in the brief that do **not** map cleanly: "CMD" is presumably
**Coffee Morning Dance**; "peTARDEO" is **Petardeo**; "The 80s & 90s Party" is
**The 90s Party**. Worth confirming — the adapter should key off audience id, not
a brand label.

### Journeys are per-event, never reused

110 journeys total across 12 audiences (~1 per event, not 1 per audience). Every
event gets a fresh journey. `can_contacts_reenter: false` on every one sampled.

**So the answer to "new journey or reuse existing per-audience journey?" is:
today the house pattern is a NEW journey per event.** Reuse would be a change in
operating model, not just implementation.

### Journey structure is uniform even though names are not

Every signup journey sampled is a **two-step** graph. Example, journey `8200`
("T26 - LISBOA - MONSANTOS", Throwback):

```
step 81610  trigger-tag_added
            trigger_settings: { tag_id: 8800465 }
            trigger_details:  { tag: { tag_name: "T26-LISBOA-MONSTANTOS" } }
step 81611  action-send_email
            display_subtext: "Autoresponder (copy 09)"
```

This is the good news: **the trigger is a static-segment (tag) id** — precisely
what `lib/d2c/audience/brief-routing.ts` already resolves. It is the direct
analogue of Bird's `contact-added-to-group` + `groupId`. The email step is a
campaign of `type: "automation-email"` (30 such exist, `status: sending`).

### Segments: the tag *is* a static segment

Confirmed on HOP ON THE TOP (15 static segments):

```
8799327 FULL LIST                        6834
8800472 H26-HALLOLWEEN                    787   ← misspelled live, correct
8800501 HOP ON THE TOP - FULL - SPANISH  8952   ← language segment, see §4
8800540 H26-MADRID-03.10.26                 1   ← the event tag
```

Tag → segment id resolution is already implemented and live-verified
(`resolveMailchimpTag`).

### Campaigns already target saved segments

Of the 200 most recent campaigns (704 in the account):

- **77** carry `recipients.segment_opts.saved_segment_id`
- **81** carry inline `conditions: [{condition_type:"StaticSegment", field:"static_segment", op:"static_is", value:<segment id>}]`

Both forms coexist and both are accepted. Type/status mix over that window:
`regular/sent=157, automation-email/sending=30, regular/schedule=6, regular/save=6, automation-email/paused=1`.

"Resend:" duplicates of most sends are routine (`Resend: HOP26-HALLOWEEN GEN SALE`)
— a resend-to-non-openers step the adapter should probably model eventually, but
it is out of scope for v1.

---

## 2. API surface — what is supported

| Need | Endpoint | Status |
|---|---|---|
| Resolve audience by id or name | `GET /3.0/lists` | ✅ documented, implemented |
| Resolve tag → static segment id | `GET /3.0/lists/{id}/segments?type=static` | ✅ documented, implemented, live-verified |
| Create a regular campaign as **draft** | `POST /3.0/campaigns` (`type: "regular"`, `status` starts `save`) | ✅ documented |
| Target audience + saved segment | `recipients: { list_id, segment_opts: { saved_segment_id } }` | ✅ documented; **77 live campaigns prove it** |
| Set subject / preview / from / title | `settings: { subject_line, preview_text, title, from_name, reply_to }` | ✅ documented |
| Set HTML + plain-text body | `PUT /3.0/campaigns/{id}/content` (`html`, `plain_text`) | ✅ documented |
| Schedule a send | `POST /3.0/campaigns/{id}/actions/schedule` (`schedule_time`, UTC, **:00/:15/:30/:45 only**) | ✅ documented — see §5 risk |
| **Create a Customer Journey** | — | ❌ **no endpoint** (STOP 1) |
| Trigger a contact into an existing journey | `POST /3.0/customer-journeys/journeys/{jid}/steps/{sid}/actions/trigger` | ✅ documented |
| List journeys / steps | `GET /3.0/customer-journeys/journeys`, `…/{id}/steps` | ⚠️ **undocumented**, works today |

### Traps measured during this audit

- **`offset` is ignored on the journeys endpoint.** `total_items: 110`, but
  `count=1000` returns 100 and `count=100&offset=100` returns *the same* 100.
  Ten journeys are unreachable through that endpoint. Do not build a
  reconciliation loop on it. (Same family as the Bird `pageToken`/`nextPageToken`
  and Bird contact-filter traps: a 200 that quietly under-delivers.)
- **`fields=` projections can zero a collection.** `?fields=total_items` returns
  `segments: []` with `total_items: 15`. Always request the array explicitly.
- Segment counts are stable and correct once queried without a narrow projection
  (15 static segments on HOP ON THE TOP, verified twice).

---

## 3. Data model — brief → Mailchimp

Brief fields already exist in the pipeline schema (`BriefAudienceRoutingInsert`
+ `BriefEventInsert`). Mapping:

| Brief field | Mailchimp resource |
|---|---|
| `mailchimp_list` | `recipients.list_id` (accepts name **or** id — already implemented) |
| `mailchimp_tag` | → `saved_segment_id` via `resolveMailchimpTag`; also the journey trigger's `tag_id` |
| `event_name`, `venue`, `date` | `settings.title`, `settings.subject_line`, body copy |
| `ticket_url` | body CTA href |
| `artwork` | body hero `<img src>` — reuse the Supabase rehost from `assets/artwork-hosting.ts`; Bird has no media API and Mailchimp's file-manager is unnecessary if the object is already public |
| `presale_open` − 1 day @ 16:45 venue-local | `schedule_time` for the reminder mailer |
| `presale_open` | `schedule_time` for the presale-live mailer |
| `general_sale` | `schedule_time` for the general-sale mailer |
| `language` | see §4 |

Proposed adapter output per brief, mirroring the Bird adapter's shape:

```
MailchimpEventReport {
  resolvedAudience { listId, listName, segmentId, segmentName }
  campaigns: [{ milestone, campaignId, webId, status:"save", scheduledFor, editUrl }]
  journey:   { status: "manual" | "triggered", journeyId?, note }
}
```

Reuse, do not duplicate: `resolveAudienceRouting`, `artwork-hosting`,
`campaigns/schedule.ts`'s zone maths, and the `runEventWhatsappPipeline`
invariants (idempotent on a deterministic name; never activate; never send).

---

## 4. Language convention

Mailchimp campaigns have **no locale property** — unlike Bird's `platformContent[].locale`.
The account already solves this with **language-scoped static segments**:

```
8800501  HOP ON THE TOP - FULL - SPANISH   8952 members
```

So the convention already in practice is: *language is a segment, not a
campaign attribute.*

**Recommended convention** (needs sign-off):

- One campaign **per language per milestone**.
- Recipients = the event tag segment **intersected** with the language segment.
  Mailchimp supports this via `segment_opts.conditions` with `match: "all"` and
  two `StaticSegment` conditions — the inline-condition form already used by 81
  live campaigns. `saved_segment_id` alone cannot express an intersection, so
  **multi-language events must use the conditions form**.
- Brief gains an optional `mailchimp_language_segments: { es: "<name>", en: "<name>" }`.
  Absent ⇒ single-language event, use `saved_segment_id` directly.
- Campaign title suffix carries the language (`… ES` / `… EN`) so the UI list is
  readable.

Rejected alternative: per-language *audiences*. It would split contact records,
break the single-tag journey trigger, and double the billable contact count.

---

## 5. Implementation plan (phased)

### Phase 1 — the three scheduled mailers (unblocked, do first)

Delivers the bulk of the manual work. No journey dependency.

1. `lib/d2c/mailchimp/event-campaigns.ts` — pure builder: brief facts →
   `{ settings, recipients, content }` per milestone. Unit-tested like
   `from-event.ts`, including a byte-comparison against a real recent campaign.
2. `createDraftCampaign()` — `POST /3.0/campaigns` (lands `status: "save"`),
   then `PUT …/content`. **Idempotent on `settings.title`**, which must be
   deterministic, mirroring the Bird campaign-name rule.
3. Schedule: `POST …/actions/schedule` with `schedule_time` in **UTC**, derived
   from venue-local wall clock + IANA zone via the existing
   `zonedWallClockToOffsetISO` maths.
   ⚠️ **Mailchimp only accepts :00/:15/:30/:45.** The house 16:45 reminder is
   fine; any other minute must be rejected loudly at build time, not rounded
   silently.
   ⚠️ Decide explicitly: scheduling makes the campaign send **without further
   human action**. Safer v1 is to create the draft and record the intended time
   *without* calling `actions/schedule`, keeping the human gate identical to the
   Bird adapter's "no audience attached" gate. **Recommendation: do not
   auto-schedule in v1.**
4. HTML: start from an existing recent campaign's content as the template
   (`GET /3.0/campaigns/{id}/content`) rather than authoring new HTML, so brand
   styling is preserved.

### Phase 2 — signup journey (blocked on STOP 1)

Options, in order of preference:

1. **Template journey + manual clone.** Adapter creates everything else and
   emits a checklist naming the journey to clone, the tag to set as trigger, and
   the email content to paste. Honest, zero risk, still removes most of the work.
2. **Reverse-engineer the internal journey API** via a DevTools capture of the
   Mailchimp UI's "save journey" — exactly the approach used for Bird
   (`docs/D2C_BIRD_JOURNEY_CAPTURE_PLAN.md`). Undocumented endpoints already
   respond to our API key on GET, so writes plausibly work too. Risk: unversioned
   internals against a 172k-contact production account.
3. **Trigger-only.** Keep one long-lived per-audience journey and push contacts
   in with the documented `actions/trigger`. This is the only *documented* write
   path, but it inverts the current operating model (per-event journeys) and
   loses per-event copy unless the email is fully templated.

**Recommendation:** ship Phase 1, run option 1 for journeys, and treat option 2
as a separate spike with its own capture plan and sign-off.

### Phase 3 — nice-to-haves

Resend-to-non-openers; reconciliation of "does this brief's campaign already
exist?"; surfacing campaign `web_id` links in the pipeline report.

---

## 6. Decisions needed from Matas

1. **Naming convention** to standardise on. Proposal, matching the tag/segment
   names that are already canonical:
   `{TAG} {MILESTONE}` → `H26-MADRID-03.10.26 PRESALE`, and journey
   `H26-MADRID-03.10.26 SIGNUP`. This keys everything to the one string the
   brief already supplies verbatim, and it is close to what HOP/Jackies/KINYXX
   do today. Existing resources would NOT be renamed.
2. **Journey approach** — option 1, 2 or 3 above.
3. **Auto-schedule or draft-only** in v1 (recommendation: draft-only).
4. **Language convention** sign-off (§4), and whether any current event is
   genuinely multi-language or all are single-language today.
5. Confirm brand↔audience mapping for CMD / peTARDEO / "The 80s & 90s Party".

## 7. Risks

- **Blast radius.** One account, 172k contacts, 704 campaigns. A bad recipients
  block sends to a whole audience instead of a 1-member segment. Mitigation:
  never auto-schedule in v1; assert `segment_opts` is non-empty before create;
  log the resolved member count and refuse if it exceeds a threshold the brief
  did not anticipate.
- **Undocumented journey endpoints can vanish** without notice, and one already
  under-delivers (`offset` ignored). Do not build anything load-bearing on them
  without the capture + a pinned fallback.
- **`Resend:` duplicates** mean title-based idempotency must not treat a resend
  as the original. Include the milestone and date in the title.
- **Segment membership at build time is not send time.** `H26-MADRID-03.10.26`
  had 1 member during this audit; it fills as signups arrive. Never gate on
  current count.
- **Misspelled-but-correct names** (`H26-HALLOLWEEN`, `T26-LISBOA-MONSTANTOS`)
  are load-bearing. The verbatim rule in `brief-routing.ts` already covers this
  and must extend to campaign creation.
