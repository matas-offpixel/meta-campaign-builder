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
  /** The rule as Meta returns it (a JSON string); compared, never shown. */
  rule: string | null;
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

export interface PendingPageRequest {
  id: string;
  pageId: string | null;
  pageName: string | null;
}

export interface McpAudienceDeps {
  /** OFFPIXEL_META_AUDIENCE_WRITES_ENABLED (the Audience Builder's own gate). */
  audienceWrites(): boolean;
  /** GET /act_{id}/customaudiences (paged). */
  listAudiences(userId: string, adAccountId: string): Promise<{ audiences: AccountAudience[]; metaGets: number; complete: boolean }>;
  /** GET /act_{id}/promote_pages with each Page's linked Instagram account. */
  promotePages(userId: string, adAccountId: string): Promise<{ pages: PromotePage[]; metaGets: number }>;
  /** The Audience Builder's access check (resolvePageAccess: the token's Page tasks, then the client's Business Manager Pages). */
  pageAccess(userId: string, pageIds: readonly string[], businessId: string | null): Promise<PageAccessRead & { metaGets: number }>;
  /** promoted_object.pixel_id per ad set (the purchase read's batch). Absent = not read. */
  adSetPixels(userId: string, adsetIds: readonly string[]): Promise<{ pixels: Map<string, string | null>; metaGets: number }>;
  /** The pixel's name and its Purchase / InitiateCheckout / CompleteRegistration counts in 28 days (GET /{pixel}/stats). */
  pixelEvents(userId: string, pixelId: string): Promise<{ name: string | null; events: PixelEvents; metaGets: number }>;
  /** CIRQLIN's page links for the show's tag (lib/cirqlin/page-links.ts), as RT11 reads them; null = not read. */
  pageLinks(tag: string): Promise<ShowLinkLite[] | null>;
  /** The show's ad videos, grouped by the Page each ran from (fetchAudienceMultiCampaignVideos, RT2). */
  showVideos(userId: string, adAccountId: string, campaignIds: readonly string[]): Promise<{ contextId: string; videoIds: string[] }[]>;
  /**
   * The Audience Builder's create for one audience: the draft row
   * (createAudienceDraft) then createMetaCustomAudience, which reuses an
   * audience whose rule is already on the account. Seed grants are off.
   */
  createAudience(input: { userId: string; insert: MetaCustomAudienceInsert }): Promise<{ rowId: string; metaAudienceId: string | null; reused: boolean; failed: boolean }>;
  /** The owner business of an ad account (GET /act_{id}?fields=business). */
  accountBusiness(userId: string, adAccountId: string): Promise<{ id: string; name: string | null } | null>;
  /** Matas's own token (user_facebook_tokens, never the env token): does it hold these permissions? null = no token. */
  tokenPermissions(userId: string): Promise<Set<string> | null>;
  /** Matas's role in a business (his business-scoped user on GET /{business}/business_users). */
  businessRole(userId: string, businessId: string): Promise<string | null>;
  /** The business's owned and client Pages (ids). */
  businessPages(userId: string, businessId: string): Promise<Set<string>>;
  /** GET /{business}/pending_client_pages. */
  pendingPages(userId: string, businessId: string): Promise<PendingPageRequest[]>;
  /** POST /{business}/client_pages through lib/meta/page-access-request.ts (ledgered, required). */
  requestPage(input: { userId: string; businessId: string; pageId: string; tasks: readonly string[]; ledger: { draftId: string; eventId: string }; key: string }): Promise<void>;
}
