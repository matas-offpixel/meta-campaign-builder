/**
 * lib/d2c/mailchimp/event-adapter.ts
 *
 * Brief → Mailchimp saved template + campaign DRAFTS. Phase 1 of
 * `docs/D2C_MAILCHIMP_ADAPTER_SCOPE.md`.
 *
 * ── Safety invariants ──────────────────────────────────────────────────────
 *
 *  1. **Never sends.** `POST /3.0/campaigns` lands `status: "save"` (a draft),
 *     and `actions/schedule` / `actions/send` are NEVER called. A human
 *     schedules from the UI. This is deliberate: scheduling makes a campaign
 *     send with no further human action, which would drop the review gate.
 *     Intended send times are returned on the report for the human to enter.
 *  2. **Never deletes.** No DELETE path exists in this module.
 *  3. **Idempotent on `settings.title`**, which is deterministic per
 *     (baseName, milestone). Re-running a brief updates content in place
 *     rather than creating a second campaign. Note `Resend:` copies are a
 *     distinct title and are left alone.
 *  4. **Refuses an unscoped send.** A campaign is never created without a
 *     non-empty `segment_opts`. An empty one silently means "the whole
 *     audience" — 15,611 people on the first live brief.
 *  5. **Reach is measured, not assumed.** Every campaign's resolved audience
 *     size is computed and reported, so a targeting mistake that would reach
 *     zero (or everyone) is visible before anyone presses send.
 *
 * Mailchimp filter params are treated as untrustworthy in the same way Bird's
 * are: counts come from `total_items` on an explicitly-requested array, never
 * from a projection (`?fields=total_items` returns an EMPTY array with a
 * non-zero count — verified).
 */

import "server-only";

import { mailchimpJson } from "./client.ts";
import { resolveBrandSender, type BrandSender } from "./brand-senders.ts";
import {
  buildEmailCopy,
  buildSegmentOpts,
  campaignTitle,
  savedTemplateName,
  MAILCHIMP_MILESTONES,
  type EmailCopy,
  type MailchimpEventInput,
  type MailchimpMilestone,
  type SegmentOpts,
  type TargetingInput,
} from "./event-campaigns.ts";

export class MailchimpAdapterError extends Error {
  readonly code = "D2C_MAILCHIMP_ADAPTER_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "MailchimpAdapterError";
  }
}

export interface MailchimpAdapterConfig {
  serverPrefix: string;
  apiKey: string;
}

export interface CampaignSettingsInput {
  fromName: string;
  replyTo: string;
}

/** Venue-local intended send time, recorded but NOT applied (invariant 1). */
export interface IntendedSend {
  /** Venue-local wall clock, e.g. "2026-08-04 16:45". */
  localTime: string;
  /** IANA zone, e.g. "Europe/Madrid". */
  timezone: string;
  /** The same instant in UTC, for whoever enters it in the UI. */
  utcIso: string;
}

export interface CampaignOutcome {
  milestone: MailchimpMilestone;
  title: string;
  campaignId: string | null;
  webId: number | null;
  status: string | null;
  existed: boolean;
  segmentOpts: SegmentOpts;
  /** Contacts the segment actually resolves to right now. */
  reach: number | null;
  intendedSend: IntendedSend | null;
  error?: string;
}

export interface MailchimpEventReport {
  listId: string;
  listName: string;
  /** Resolved per-brand sender identity actually written to every campaign. */
  sender: BrandSender;
  eventSegmentId: number;
  eventSegmentName: string;
  languageSegmentId: number | null;
  savedTemplate: { id: number | null; name: string; existed: boolean; error?: string };
  campaigns: CampaignOutcome[];
}

interface McList { id: string; name: string }
interface McSegment { id: number; name: string; member_count: number }

/** Explicitly request the array — a `fields=total_items` projection returns []. */
async function listStaticSegments(cfg: MailchimpAdapterConfig, listId: string): Promise<McSegment[]> {
  const res = await mailchimpJson<{ segments?: McSegment[]; total_items?: number }>(
    cfg.serverPrefix, cfg.apiKey,
    `/3.0/lists/${encodeURIComponent(listId)}/segments?type=static&count=1000`,
    { method: "GET" },
  );
  const segs = res.segments ?? [];
  if (typeof res.total_items === "number" && res.total_items > segs.length) {
    throw new MailchimpAdapterError(
      `Segment listing truncated for list ${listId}: got ${segs.length} of ${res.total_items}. ` +
        "Refusing to match a name against a partial list.",
    );
  }
  return segs;
}

/** Exact, verbatim match. Misspelled live names are correct — never normalise. */
function findExact<T extends { name: string }>(rows: T[], name: string, label: string): T {
  const exact = rows.filter((r) => r.name.trim() === name.trim());
  if (exact.length === 1) return exact[0];
  const near = rows
    .filter((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase() && r.name.trim() !== name.trim())
    .map((r) => JSON.stringify(r.name));
  if (exact.length > 1) {
    throw new MailchimpAdapterError(`${label} ${JSON.stringify(name)} is ambiguous (${exact.length} matches).`);
  }
  throw new MailchimpAdapterError(
    `${label} ${JSON.stringify(name)} does not exist.` +
      (near.length ? ` Did you mean ${near.join(" or ")}? (Not substituted — fix the brief.)` : ""),
  );
}

/**
 * How many contacts a `segment_opts` actually resolves to. Computed locally
 * from static-segment membership rather than trusting a server-side filter.
 */
async function estimateReach(
  cfg: MailchimpAdapterConfig,
  listId: string,
  opts: SegmentOpts,
  audienceTotal: number,
  segById: Map<number, McSegment>,
): Promise<number | null> {
  const includes = opts.conditions.filter((c) => c.op === "static_is").map((c) => c.value);
  const excludes = opts.conditions.filter((c) => c.op === "static_not").map((c) => c.value);

  const membersOf = async (segId: number): Promise<string[]> => {
    const out: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const res = await mailchimpJson<{ members?: { id: string }[]; total_items?: number }>(
        cfg.serverPrefix, cfg.apiKey,
        `/3.0/lists/${encodeURIComponent(listId)}/segments/${segId}/members?count=1000&offset=${offset}`,
        { method: "GET" },
      );
      const batch = res.members ?? [];
      for (const m of batch) out.push(m.id);
      if (batch.length < 1000) break;
    }
    return out;
  };

  try {
    if (includes.length === 0) {
      // Base is the whole audience minus the excluded segments.
      let n = audienceTotal;
      for (const ex of excludes) n -= segById.get(ex)?.member_count ?? 0;
      return Math.max(0, n);
    }
    let acc: string[] | null = null;
    for (const inc of includes) {
      const s = await membersOf(inc);
      acc = acc === null ? s : acc.filter((x) => s.includes(x));
    }
    for (const ex of excludes) {
      const s = await membersOf(ex);
      acc = (acc ?? []).filter((x) => !s.includes(x));
    }
    return acc?.length ?? null;
  } catch {
    return null; // reach is diagnostic, never load-bearing
  }
}

async function findCampaignByTitle(
  cfg: MailchimpAdapterConfig, listId: string, title: string,
): Promise<{ id: string; web_id: number; status: string } | null> {
  for (let offset = 0; ; offset += 1000) {
    const res = await mailchimpJson<{ campaigns?: { id: string; web_id: number; status: string; settings?: { title?: string } }[] }>(
      cfg.serverPrefix, cfg.apiKey,
      `/3.0/campaigns?count=1000&offset=${offset}&list_id=${encodeURIComponent(listId)}`,
      { method: "GET" },
    );
    const batch = res.campaigns ?? [];
    const hit = batch.find((c) => (c.settings?.title ?? "").trim() === title.trim());
    if (hit) return { id: hit.id, web_id: hit.web_id, status: hit.status };
    if (batch.length < 1000) return null;
  }
}

export interface RunMailchimpAdapterInput {
  event: MailchimpEventInput;
  /** Mailchimp audience id or name — verbatim from the brief. */
  mailchimpList: string;
  /** Static-segment (tag) name — verbatim from the brief. */
  mailchimpTag: string;
  /** Optional language segment NAME, applied to the announcement. */
  languageSegmentName?: string;
  applyLanguageToTagStages?: boolean;
  /** @deprecated ignored — the sender is resolved from brand-senders.ts. */
  settings?: CampaignSettingsInput;
  /** Intended (unapplied) send times per milestone. */
  intendedSends?: Partial<Record<MailchimpMilestone, IntendedSend>>;
  milestones?: readonly MailchimpMilestone[];
  dryRun?: boolean;
}

export async function runMailchimpEventAdapter(
  cfg: MailchimpAdapterConfig,
  input: RunMailchimpAdapterInput,
): Promise<MailchimpEventReport> {
  const milestones = input.milestones ?? MAILCHIMP_MILESTONES;

  // ── resolve audience + segments (verbatim, fail loud) ────────────────────
  const listsRes = await mailchimpJson<{ lists?: (McList & { stats?: { member_count?: number } })[] }>(
    cfg.serverPrefix, cfg.apiKey, "/3.0/lists?count=1000", { method: "GET" },
  );
  const lists = listsRes.lists ?? [];
  const byId = lists.filter((l) => l.id === input.mailchimpList.trim());
  const list = byId.length === 1 ? byId[0] : findExact(lists, input.mailchimpList, "mailchimp_list");
  const audienceTotal = list.stats?.member_count ?? 0;

  // Resolve the sender BEFORE any write: an unmapped brand must abort the run
  // rather than create campaigns that would go out from the wrong address.
  const sender: BrandSender = resolveBrandSender(list.id);

  const segments = await listStaticSegments(cfg, list.id);
  const segById = new Map(segments.map((s) => [s.id, s]));
  const eventSeg = findExact(segments, input.mailchimpTag, "mailchimp_tag");
  const langSeg = input.languageSegmentName
    ? findExact(segments, input.languageSegmentName, "language segment")
    : null;

  const targeting: TargetingInput = {
    eventSegmentId: eventSeg.id,
    languageSegmentId: langSeg?.id,
    applyLanguageToTagStages: input.applyLanguageToTagStages,
  };

  const report: MailchimpEventReport = {
    listId: list.id,
    listName: list.name,
    sender,
    eventSegmentId: eventSeg.id,
    eventSegmentName: eventSeg.name,
    languageSegmentId: langSeg?.id ?? null,
    savedTemplate: { id: null, name: savedTemplateName(input.event.baseName), existed: false },
    campaigns: [],
  };

  // ── 1. saved template for the signup autoresponder ───────────────────────
  const autoresp: EmailCopy = buildEmailCopy("autoresp", input.event);
  if (!input.dryRun) {
    try {
      const existing = await mailchimpJson<{ templates?: { id: number; name: string }[] }>(
        cfg.serverPrefix, cfg.apiKey, "/3.0/templates?count=1000&type=user", { method: "GET" },
      );
      const hit = (existing.templates ?? []).find((t) => t.name.trim() === autoresp.title.trim());
      if (hit) {
        report.savedTemplate = { id: hit.id, name: hit.name, existed: true };
      } else {
        const created = await mailchimpJson<{ id: number; name: string }>(
          cfg.serverPrefix, cfg.apiKey, "/3.0/templates",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: autoresp.title, html: autoresp.html }) },
        );
        report.savedTemplate = { id: created.id, name: created.name, existed: false };
      }
    } catch (e) {
      report.savedTemplate.error = e instanceof Error ? e.message : String(e);
    }
  }

  // ── 2-5. campaign drafts ─────────────────────────────────────────────────
  for (const milestone of milestones) {
    const copy = buildEmailCopy(milestone, input.event);
    const segmentOpts = buildSegmentOpts(milestone, targeting);
    const intendedSend = input.intendedSends?.[milestone] ?? null;

    // Invariant 4: never create an unscoped campaign.
    if (segmentOpts.conditions.length === 0) {
      report.campaigns.push({
        milestone, title: copy.title, campaignId: null, webId: null, status: null,
        existed: false, segmentOpts, reach: null, intendedSend,
        error: "refusing to create a campaign with empty segment_opts (would target the whole audience)",
      });
      continue;
    }

    const reach = input.dryRun ? null : await estimateReach(cfg, list.id, segmentOpts, audienceTotal, segById);

    if (input.dryRun) {
      report.campaigns.push({ milestone, title: copy.title, campaignId: null, webId: null, status: "dry_run", existed: false, segmentOpts, reach, intendedSend });
      continue;
    }

    try {
      const settings = {
        title: copy.title,
        subject_line: copy.subject,
        preview_text: copy.preview,
        // Sender comes from the per-brand map, NEVER from a caller default.
        // See brand-senders.ts: an unmapped brand throws rather than shipping
        // a client email from the agency address.
        from_name: sender.fromName,
        reply_to: sender.replyTo,
        auto_footer: false,
      };

      const existing = await findCampaignByTitle(cfg, list.id, copy.title);
      let campaignId: string, webId: number, status: string, existed: boolean;
      if (existing) {
        ({ id: campaignId, web_id: webId, status } = existing);
        existed = true;
        // Converge settings AND recipients too, not just content — otherwise a
        // re-run silently leaves a stale subject line or stale targeting on an
        // existing draft, which is exactly the kind of drift that ships.
        // Only ever PATCHed while the campaign is still a draft.
        if (status === "save") {
          await mailchimpJson(
            cfg.serverPrefix, cfg.apiKey, `/3.0/campaigns/${campaignId}`,
            {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ settings, recipients: { list_id: list.id, segment_opts: segmentOpts } }),
            },
          );
        }
      } else {
        const created = await mailchimpJson<{ id: string; web_id: number; status: string }>(
          cfg.serverPrefix, cfg.apiKey, "/3.0/campaigns",
          {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "regular",
              recipients: { list_id: list.id, segment_opts: segmentOpts },
              settings,
            }),
          },
        );
        campaignId = created.id; webId = created.web_id; status = created.status; existed = false;
      }

      // Content is (re)written either way, so a re-run converges.
      await mailchimpJson(
        cfg.serverPrefix, cfg.apiKey, `/3.0/campaigns/${campaignId}/content`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ html: copy.html, plain_text: copy.plainText }) },
      );

      report.campaigns.push({ milestone, title: copy.title, campaignId, webId, status, existed, segmentOpts, reach, intendedSend });
    } catch (e) {
      report.campaigns.push({
        milestone, title: copy.title, campaignId: null, webId: null, status: null,
        existed: false, segmentOpts, reach, intendedSend,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return report;
}

export { campaignTitle, savedTemplateName };
