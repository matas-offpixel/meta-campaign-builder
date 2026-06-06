/**
 * Sanitize a Dropbox/original filename for Supabase Storage paths.
 * Preserves descriptive text (aspect hints) while stripping path separators.
 */
export function sanitizeStorageFileName(originalName: string): string {
  const base = originalName.split(/[/\\]/).pop()?.trim() ?? "asset";
  const cleaned = base
    .replace(/[^\w.\- ()]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^\.+/, "");
  return (cleaned || "asset").slice(0, 200);
}

/**
 * Build a unique storage path under queue/{queueId}/ for the given filename.
 */
export function buildQueueStoragePath(
  queueId: string,
  originalName: string,
  usedPaths: Set<string>,
): string {
  const safeName = sanitizeStorageFileName(originalName);
  const dot = safeName.lastIndexOf(".");
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const ext = dot > 0 ? safeName.slice(dot) : "";

  let candidate = `queue/${queueId}/${safeName}`;
  let n = 2;
  while (usedPaths.has(candidate)) {
    candidate = `queue/${queueId}/${stem}-${n}${ext}`;
    n += 1;
  }
  usedPaths.add(candidate);
  return candidate;
}
