/**
 * Ask a Facebook Page for access from a client's Business Manager (M3c,
 * the connector's request_page_access).
 *
 * POST /{business_id}/client_pages { page_id, permitted_tasks } as a
 * business admin with pages_manage_metadata and pages_show_list (Meta's
 * Pages guide, Business Asset Management). The Page's admins approve it,
 * unless the requester already admins the Page. Pending requests are
 * GET /{business_id}/pending_client_pages.
 *
 * Matas, 26 Nov: "do it from the clients business manager so data and access
 * stays with them". So Off/Pixel's own business is refused here, whatever
 * the caller passes, and there is no fallback to another business.
 *
 * Every request is on meta_write_idempotency as `page_access_request`
 * (migration 273) with `{ required: true }`, keyed on the ask; the payload
 * names the business so the daily cap can count by it.
 *
 * The Graph call is passed in, so tests run on fakes. Instagram has no
 * documented create for client_instagram_assets: it stays the manual
 * Business Suite step.
 */

import { withMetaWriteIdempotency, type MetaWriteContext } from "./write-idempotency.ts";

/** Off/Pixel's own Business Manager: never the requester. */
export const OFF_PIXEL_BUSINESS_ID = "944651277948334";

/** The Page tasks Meta accepts on a client_pages request (lib/bm/asset-kinds.ts PAGE.permittedTasks). */
export const PAGE_REQUEST_TASKS = ["MANAGE", "CREATE_CONTENT", "MODERATE", "ADVERTISE", "ANALYZE"] as const;
export const DEFAULT_PAGE_REQUEST_TASKS = ["ADVERTISE", "ANALYZE"] as const;

/** Meta locks a business whose requests are reported as spam: at most this many a day from one. */
export const PAGE_REQUESTS_PER_DAY = 5;

export class OffPixelBusinessRefused extends Error {
  constructor() {
    super("page access is never requested from Off/Pixel's business");
    this.name = "OffPixelBusinessRefused";
  }
}

export type PageAccessGraph = {
  postClientPage(businessId: string, body: { page_id: string; permitted_tasks: string }): Promise<void>;
};

export async function writePageAccessRequest(args: {
  ledger: MetaWriteContext;
  graph: PageAccessGraph;
  businessId: string;
  pageId: string;
  tasks: readonly string[];
  key: string;
}): Promise<string> {
  const businessId = args.businessId.trim();
  if (businessId === OFF_PIXEL_BUSINESS_ID) throw new OffPixelBusinessRefused();
  if (!/^\d+$/.test(businessId)) throw new Error(`not a business id: ${businessId}`);
  if (!/^\d+$/.test(args.pageId)) throw new Error(`not a Page id: ${args.pageId}`);
  const tasks = [...new Set(args.tasks)];
  if (tasks.length === 0 || tasks.some((t) => !(PAGE_REQUEST_TASKS as readonly string[]).includes(t))) throw new Error("bad tasks");
  return withMetaWriteIdempotency(
    args.ledger,
    "page_access_request",
    { business_id: businessId, page_id: args.pageId, tasks, key: args.key },
    async () => {
      await args.graph.postClientPage(businessId, { page_id: args.pageId, permitted_tasks: JSON.stringify(tasks) });
      return args.pageId;
    },
    { required: true },
  );
}
