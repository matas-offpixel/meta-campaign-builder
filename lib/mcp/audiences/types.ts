/**
 * lib/mcp/audiences/types.ts — what the M3c tools reach outside the database
 * (McpAudienceDeps). The route passes the real ones (lib/mcp/audience-deps.ts,
 * a pinned seam); tests pass spies. Every read is a GET. The two writes are
 * the app's own: the Audience Builder's create (createMetaCustomAudience,
 * OFFPIXEL_META_AUDIENCE_WRITES_ENABLED) and the client_pages request
 * (lib/meta/page-access-request.ts, ledger page_access_request).
 *
 * Relative imports only (node:test).
 */
import type { MetaCustomAudienceInsert } from "../../types/audience.ts";

/** One custom audience on an ad account, as Meta lists it. */
export interface AccountAudience {
  id: string;
  name: string | null;
  subtype: string | null;
  retentionDays: number | null;
  lower: number | null;
  upper: number | null;
  /** delivery_status.description (e.g. "This audience is ready for use."), else its code. */
  delivery: string | null;
  /** operation_status.description, else its code. */
  operation: string | null;
  /** The rule as Meta returns it (a JSON string); compared, never shown. Null when Meta couldn't send it. */
  rule: string | null;
  /** delivery_status.code: 300 is Meta's "too small". */
  deliveryCode?: number | null;
  /** A LOOKALIKE's spec: its origin audience, country and ratio. */
  lookalike?: { originId: string | null; country: string | null; ratio: number | null } | null;
}

export interface PromotePage {
  id: string;
  name: string | null;
  igId: string | null;
  igUsername: string | null;
}

export interface PageAccessRead {
  accessible: string[];
  /** Page id → name, for any Page Meta named. */
  names: Record<string, string>;
}

/** The three pixel events audience_sources checks; null = not read. */
export type PixelEvents = { Purchase: number | null; InitiateCheckout: number | null; CompleteRegistration: number | null };

export interface ShowLinkLite {
  kind: "ticket" | "landing";
  name: string;
  url: string;
  /** The "URL contains" fragment (host + path). */
  rule: string;
}

/** A Page or Instagram account a business holds: its own (owned) or shared into it (client_shared). Instagram: id is the IG user id, name the username. */
export interface BusinessAsset {
  id: string;
  name: string | null;
  reach: "owned" | "client_shared";
}

export interface PendingPageRequest {
  id: string;
  pageId: string | null;
  pageName: string | null;
}

export interface McpAudienceDeps {
  /**
   * Time limits (Matas, 27 Nov): each outside read gives up after `perReadMs`
   * and the whole read after `budgetMs`, answering with what it has. Omitted =
   * READ_LIMITS (lib/mcp/audiences/sources.ts). Tests pass small ones.
   */
  limits?: { perReadMs: number; budgetMs: number; listMs?: number };
  /** OFFPIXEL_META_AUDIENCE_WRITES_ENABLED (the Audience Builder's own gate). */
  audienceWrites(): boolean;
  /** GET /act_{id}/customaudiences (paged). */
  listAudiences(userId: string, adAccountId: string, signal?: AbortSignal): Promise<{ audiences: AccountAudience[]; metaGets: number; complete: boolean }>;
  /** GET /act_{id}/promote_pages with each Page's linked Instagram account. */
  promotePages(userId: string, adAccountId: string, signal?: AbortSignal): Promise<{ pages: PromotePage[]; metaGets: number }>;
  /** The Audience Builder's access check (resolvePageAccess: the token's Page tasks, then the client's Business Manager Pages). */
  pageAccess(userId: string, pageIds: readonly string[], businessId: string | null, signal?: AbortSignal): Promise<PageAccessRead & { metaGets: number }>;
  /** promoted_object.pixel_id per ad set (the purchase read's batch). Absent = not read. */
  adSetPixels(userId: string, adsetIds: readonly string[], signal?: AbortSignal): Promise<{ pixels: Map<string, string | null>; metaGets: number }>;
  /** The pixel's name and its Purchase / InitiateCheckout / CompleteRegistration counts in 28 days (GET /{pixel}/stats). */
  pixelEvents(userId: string, pixelId: string, signal?: AbortSignal): Promise<{ name: string | null; events: PixelEvents; metaGets: number }>;
  /** CIRQLIN's page links for the show's tag (lib/cirqlin/page-links.ts), as RT11 reads them; null = not read. */
  pageLinks(tag: string, signal?: AbortSignal): Promise<ShowLinkLite[] | null>;
  /** The show's ad videos, grouped by the Page each ran from (fetchAudienceMultiCampaignVideos, RT2). */
  showVideos(userId: string, adAccountId: string, campaignIds: readonly string[], signal?: AbortSignal): Promise<{ contextId: string; videoIds: string[] }[]>;
  /**
   * The Audience Builder's create for one audience: the draft row
   * (createAudienceDraft) then createMetaCustomAudience, which reuses an
   * audience whose rule is already on the account. Seed grants are off.
   */
  createAudience(input: { userId: string; insert: MetaCustomAudienceInsert; /** "refuse": a failed existing-audience lookup posts nothing (no second copy). Default "create". */ onLookupFailed?: "create" | "refuse" }): Promise<{ rowId: string; metaAudienceId: string | null; reused: boolean; failed: boolean; /** The row's status_error when failed (Meta's message with code, subcode, fbtrace_id; never a token). */ error?: string | null; /** Not made because the lookup failed under "refuse": nothing was posted. */ lookupUnavailable?: boolean }>;
  /** The owner business of an ad account (GET /act_{id}?fields=business). */
  accountBusiness(userId: string, adAccountId: string, signal?: AbortSignal): Promise<{ id: string; name: string | null } | null>;
  /** Matas's own token (user_facebook_tokens, never the env token): does it hold these permissions? null = no token. */
  tokenPermissions(userId: string): Promise<Set<string> | null>;
  /** Matas's role in a business (his business-scoped user on GET /{business}/business_users). */
  businessRole(userId: string, businessId: string): Promise<string | null>;
  /** The business's owned and client Pages (ids). */
  businessPages(userId: string, businessId: string): Promise<Set<string>>;
  /** The business's Pages and Instagram accounts (owned_pages, client_pages, owned_instagram_assets, client_instagram_assets), as Matas. */
  businessAssets(userId: string, businessId: string, signal?: AbortSignal): Promise<{ pages: BusinessAsset[]; instagram: BusinessAsset[] }>;
  /** GET /{business}/pending_client_pages. */
  pendingPages(userId: string, businessId: string): Promise<PendingPageRequest[]>;
  /** POST /{business}/client_pages through lib/meta/page-access-request.ts (ledgered, required). */
  requestPage(input: { userId: string; businessId: string; pageId: string; tasks: readonly string[]; ledger: { draftId: string; eventId: string }; key: string }): Promise<void>;
}
