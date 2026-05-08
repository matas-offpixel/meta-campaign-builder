/**
 * Whether deferred thumbnail warming should run after rollup-sync (Meta leg
 * succeeded and we have enough context to resolve creatives).
 */
export function shouldQueueThumbnailWarmAfterRollupSync(args: {
  metaOk: boolean;
  adAccountId: string | null;
  eventCode: string | null;
}): boolean {
  return (
    args.metaOk &&
    Boolean(args.adAccountId?.trim()) &&
    Boolean(args.eventCode?.trim())
  );
}
