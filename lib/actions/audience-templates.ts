"use server";

import { MATAS_USER_IDS, isOperator } from "@/lib/auth/operator-allowlist";
import { normalizeAdAccountId } from "@/lib/meta/ad-account";
import { metaAudienceWritesEnabled } from "@/lib/meta/audience-write";
import {
  dedupeKnown,
  knownFromDraftAudiences,
  knownFromRows,
  type AudienceTemplate,
  type CustomAudienceRow,
  type KnownAudience,
  type TemplateItem,
} from "@/lib/audience-templates/resolve";
import { ITEM_CONFLICT_KEY, itemRow, templateFromRows, type ItemRowIn, type TemplateRowIn } from "@/lib/audience-templates/store";
import { templateOrder } from "@/lib/audience-templates/view";
import { createClient } from "@/lib/supabase/server";

/**
 * Audience templates tab (R6, record RC5): the reads behind it, and "Save to
 * template". Operators only, through the operator's own session (owner RLS
 * on the templates, migration 266).
 *
 * Reads only the database. It never calls Meta: Reused / Will be created is
 * decided from what the app stored (lib/audience-templates/resolve.ts). The
 * tab creates nothing; OFFPIXEL_META_AUDIENCE_WRITES_ENABLED is read only to
 * say whether the items to create wait.
 */

const PAGE = 1000;

export interface TemplatePage {
  pageId: string;
  name: string;
}

export interface AudienceTemplatesPayload {
  templates: AudienceTemplate[];
  known: KnownAudience[];
  accountId: string;
  accountName: string;
  pixelId: string | null;
  pixelName: string | null;
  writesEnabled: boolean;
  /** user id → display name, for "confirmed by". */
  confirmerNames: Record<string, string>;
  /** The business's pages, for "Add page to this group". */
  pages: TemplatePage[];
}

type Db = Awaited<ReturnType<typeof createClient>>;
type Row = Record<string, unknown>;

async function pagedRows(run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let at = 0; ; at += PAGE) {
    const { data, error } = await run(at, at + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function operator(db: Db): Promise<string | null> {
  const { data } = await db.auth.getUser();
  const id = data.user?.id ?? null;
  return id && isOperator(id) ? id : null;
}

/**
 * The templates for the draft's client (by its business manager, or the
 * client itself), resolved against the draft's ad account. Null when the
 * client has none: the drawer then shows the Audiences tab alone, as before.
 */
export async function loadAudienceTemplates(input: {
  clientId: string | null | undefined;
  adAccountId: string | null | undefined;
  pixelId: string | null | undefined;
}): Promise<AudienceTemplatesPayload | null> {
  const accountId = normalizeAdAccountId(input.adAccountId);
  if (!input.clientId || !accountId) return null;
  const db = await createClient();
  if (!(await operator(db))) return null;

  const client = await db.from("clients").select("id, meta_business_id").eq("id", input.clientId).maybeSingle();
  if (client.error || !client.data) return null;
  const businessId = typeof client.data.meta_business_id === "string" && client.data.meta_business_id ? client.data.meta_business_id : null;

  const filter = businessId ? `business_id.eq.${businessId},client_id.eq.${input.clientId}` : `client_id.eq.${input.clientId}`;
  const templateRows = (await pagedRows((a, b) =>
    db
      .from("audience_templates")
      .select("id, name, business_id, client_id, genre_families, notes, confirmed_by, confirmed_at")
      .or(filter)
      .order("name")
      .range(a, b),
  )) as unknown as TemplateRowIn[];
  if (templateRows.length === 0) return null;

  const itemRows = (await pagedRows((a, b) =>
    db
      .from("audience_template_items")
      .select("id, template_id, kind, list_role, family_key, page_id, retention_days, interest_id, interest_name, meta_audience_id, detail")
      .in("template_id", templateRows.map((t) => t.id))
      .order("id")
      .range(a, b),
  )) as unknown as ItemRowIn[];

  const templates = templateRows
    .map((t) => templateFromRows(t, itemRows))
    .sort((a, b) => templateOrder(a.name) - templateOrder(b.name));

  const audienceRows = (await pagedRows((a, b) =>
    db
      .from("meta_custom_audiences")
      .select("meta_audience_id, meta_ad_account_id, audience_subtype, list_role, retention_days, source_id, source_meta, event_id, status")
      .in("meta_ad_account_id", [accountId, accountId.slice(4)])
      .order("id")
      .range(a, b),
  )) as unknown as CustomAudienceRow[];


  const draftRows = await pagedRows((a, b) =>
    db.from("campaign_drafts").select("id, audiences:draft_json->audiences").eq("client_id", input.clientId!).order("id").range(a, b),
  );

  const known = dedupeKnown([
    ...knownFromRows(audienceRows),
    ...draftRows.flatMap((d) => knownFromDraftAudiences(d.audiences)),
  ]);

  let accountName: string = accountId;
  let pixelName: string | null = null;
  let pages: TemplatePage[] = [];
  if (businessId) {
    const acct = await db.from("bm_ad_accounts").select("name").eq("business_id", businessId).eq("ad_account_id", accountId).maybeSingle();
    if (typeof acct.data?.name === "string" && acct.data.name) accountName = acct.data.name;
    if (input.pixelId) {
      const px = await db.from("bm_pixels").select("name").eq("business_id", businessId).eq("pixel_id", input.pixelId).maybeSingle();
      if (typeof px.data?.name === "string" && px.data.name) pixelName = px.data.name;
    }
    const pageRows = await pagedRows((a, b) =>
      db.from("bm_pages").select("page_id, page_name").eq("business_id", businessId).order("page_name").range(a, b),
    );
    pages = pageRows.flatMap((r) =>
      typeof r.page_id === "string" && typeof r.page_name === "string" && r.page_name.trim()
        ? [{ pageId: r.page_id, name: r.page_name.trim() }]
        : [],
    );
  }

  const confirmerNames: Record<string, string> = {};
  for (const t of templates) if (t.confirmedBy && MATAS_USER_IDS.includes(t.confirmedBy)) confirmerNames[t.confirmedBy] = "Matas";

  return {
    templates,
    known,
    accountId,
    accountName,
    pixelId: input.pixelId ?? null,
    pixelName,
    writesEnabled: metaAudienceWritesEnabled(),
    confirmerNames,
    pages,
  };
}

export type SaveTemplateResult = { ok: true; saved: number } | { ok: false; error: string };

/**
 * "Save to template": the pages added with "Add page to this group" become
 * the template's items (Facebook + Instagram engagers, 365 days). Adds only;
 * an item already in the template is left as it is. Never calls Meta.
 */
export async function saveTemplatePages(templateId: string, items: TemplateItem[]): Promise<SaveTemplateResult> {
  const db = await createClient();
  const userId = await operator(db);
  if (!userId) return { ok: false, error: "operators only" };
  const pages = items.filter((i) => i.kind === "page_engagers" && i.pageId && /^\d+$/.test(i.pageId));
  if (pages.length === 0) return { ok: true, saved: 0 };
  const rows = pages.map((i) => ({ ...itemRow({ ...i, retentionDays: i.retentionDays ?? 365 }, userId), template_id: templateId }));
  const res = await db.from("audience_template_items").upsert(rows, {
    onConflict: ITEM_CONFLICT_KEY,
    ignoreDuplicates: true,
  });
  if (res.error) return { ok: false, error: res.error.message };
  return { ok: true, saved: rows.length };
}
