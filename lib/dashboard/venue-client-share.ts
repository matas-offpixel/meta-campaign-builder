/**
 * Internal venue report shows the client-level Share affordance; share URLs do
 * not. Gate on an explicit prop — do not use `usePathname()` (basePath / prod
 * routing can differ from local dev).
 */
export function shouldShowVenueClientShare(
  shareClientId: string | null | undefined,
  showClientShareButton: boolean,
): boolean {
  return Boolean(shareClientId) && showClientShareButton;
}
