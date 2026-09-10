export function shouldOpenManualIdentityHatch(input: {
  identityFailed: boolean;
  identitiesLength: number;
  selectedIdentityNeedsType: boolean;
  loadingDetails: boolean;
  hasAdvertiser: boolean;
}): boolean {
  if (input.identityFailed || input.selectedIdentityNeedsType) return true;
  return (
    input.hasAdvertiser &&
    !input.loadingDetails &&
    input.identitiesLength === 0
  );
}

export function tikTokIdentityInitial(displayName: string): string {
  return displayName.trim().charAt(0).toUpperCase() || "?";
}

export function tikTokIdentityFace(
  avatarUrl: string | null | undefined,
  displayName: string,
): { kind: "image"; src: string } | { kind: "chip"; initial: string } {
  const src = avatarUrl?.trim() ?? "";
  if (src) return { kind: "image", src };
  return { kind: "chip", initial: tikTokIdentityInitial(displayName) };
}

export function tikTokIdentityOptionView(identity: {
  display_name: string;
  avatar_url: string | null;
  identity_type: string | null;
}): {
  face: ReturnType<typeof tikTokIdentityFace>;
  label: string;
  typeCaption: string | null;
} {
  return {
    face: tikTokIdentityFace(identity.avatar_url, identity.display_name),
    label: identity.display_name,
    typeCaption: identity.identity_type,
  };
}
