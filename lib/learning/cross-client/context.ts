import "server-only";

import { requireOperator as requireOperatorSession } from "@/lib/bm/route-auth";
import { MATAS_USER_IDS, isOperator } from "@/lib/auth/operator-allowlist";

/**
 * Cross-client copy is operator-only. The constructor is private: a route
 * gets a context from requireOperator(), which checks the session and the
 * allowlist. Client names are included only for Matas.
 */
export class OperatorContext {
  readonly userId: string;
  readonly seesClientNames: boolean;

  private constructor(userId: string, seesClientNames: boolean) {
    this.userId = userId;
    this.seesClientNames = seesClientNames;
  }

  /** Allowlisted user, no session. requireOperator() is the route entry. */
  static forAllowlistedUser(userId: string): OperatorContext {
    if (!isOperator(userId)) throw new Error("not an operator");
    return new OperatorContext(userId, MATAS_USER_IDS.includes(userId));
  }
}

export function displayClientName(name: string, seesClientNames: boolean): string {
  return seesClientNames ? name : "another client";
}

export async function requireOperator(): Promise<
  { ok: true; context: OperatorContext } | { ok: false; response: import("next/server").NextResponse }
> {
  const session = await requireOperatorSession();
  if (!session.ok) return { ok: false, response: session.response };
  return { ok: true, context: OperatorContext.forAllowlistedUser(session.user.id) };
}
