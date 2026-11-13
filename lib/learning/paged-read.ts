/**
 * The learning loop's paged reader is the shared one in lib/db/paged-read.ts
 * (the import direction lib/learning → lib/db is the right way round).
 */
export { loadAllPaged, pageAll, dedupeOn, PAGE_SIZE, type PagedQuery, type OrderBy } from "../db/paged-read.ts";
