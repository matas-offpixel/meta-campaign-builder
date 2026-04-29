export function shouldInvokeVenueAllocator(input: {
  metaOk: boolean;
  eventCode: string | null | undefined;
  adAccountId: string | null | undefined;
  clientId: string | null | undefined;
}): boolean {
  return Boolean(
    input.metaOk && input.eventCode && input.adAccountId && input.clientId,
  );
}
