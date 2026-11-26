/**
 * lib/mcp/audiences/access.ts — request_page_access's fixed values, from the
 * helper that sends the request (lib/meta/page-access-request.ts), so the
 * tool and the helper can't disagree: Off/Pixel's business is refused in both.
 *
 * Relative imports only (node:test).
 */
import { DEFAULT_PAGE_REQUEST_TASKS, OFF_PIXEL_BUSINESS_ID, PAGE_REQUESTS_PER_DAY, PAGE_REQUEST_TASKS } from "../../meta/page-access-request.ts";

export const ACCESS = { DEFAULT_PAGE_REQUEST_TASKS, OFF_PIXEL_BUSINESS_ID, PAGE_REQUESTS_PER_DAY, PAGE_REQUEST_TASKS } as const;
