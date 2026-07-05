/**
 * Pure login-form seams — password sign-in error mapping and mode toggling.
 * Client pages import these; node:test pins behaviour without DOM renders.
 */

export type LoginFormMode = "password" | "magic-link";

/** Swap primary password form ↔ magic-link fallback. */
export function toggleLoginFormMode(current: LoginFormMode): LoginFormMode {
  return current === "password" ? "magic-link" : "password";
}

export const INVALID_CREDENTIALS_MESSAGE = "Wrong email or password";

export type PasswordSignInErrorCode = "invalid_credentials" | "other";

export type PasswordSignInResult =
  | { ok: true }
  | { ok: false; code: PasswordSignInErrorCode; message: string };

/** Map Supabase signInWithPassword errors to user-facing copy. */
export function mapPasswordSignInError(message: string): PasswordSignInResult {
  if (/invalid login credentials/i.test(message)) {
    return {
      ok: false,
      code: "invalid_credentials",
      message: INVALID_CREDENTIALS_MESSAGE,
    };
  }
  return { ok: false, code: "other", message };
}

export type SignInWithPasswordFn = (
  email: string,
  password: string,
) => Promise<{ error: { message: string } | null }>;

/**
 * Testable boundary around supabase.auth.signInWithPassword. Password is
 * passed through to the injected fn only — never logged here.
 */
export async function signInWithPasswordBoundary(
  signIn: SignInWithPasswordFn,
  email: string,
  password: string,
): Promise<PasswordSignInResult> {
  if (!email.trim() || !password) {
    return {
      ok: false,
      code: "other",
      message: "Email and password are required.",
    };
  }

  const { error } = await signIn(email.trim(), password);
  if (!error) return { ok: true };
  return mapPasswordSignInError(error.message);
}

export type MagicLinkErrorVariant = "admin" | "operator";

/** Map signInWithOtp errors — admin has invite-only copy. */
export function mapMagicLinkError(
  message: string,
  variant: MagicLinkErrorVariant,
): string {
  if (
    variant === "admin" &&
    /signups not allowed|user not found/i.test(message)
  ) {
    return "This email isn't registered. Contact Off/Pixel to get access.";
  }
  return message;
}
