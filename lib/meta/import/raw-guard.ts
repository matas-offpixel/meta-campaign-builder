import { isOperator } from "../../auth/operator-allowlist.ts";

export type MetaImportRawGuard =
  | { ok: true; adAccountId: string; campaignId: string }
  | { ok: false; status: number; error: string };

export function guardMetaImportRaw(input: {
  adAccountId: string | null;
  campaignId: string | null;
  userId: string | null;
}): MetaImportRawGuard {
  if (!input.userId) {
    return { ok: false, status: 401, error: "Not signed in" };
  }
  if (!isOperator(input.userId)) {
    return { ok: false, status: 403, error: "Not permitted" };
  }
  const adAccountId = input.adAccountId?.trim() || null;
  const campaignId = input.campaignId?.trim() || null;
  if (!adAccountId || !campaignId) {
    return {
      ok: false,
      status: 400,
      error: "adAccountId and campaignId are required",
    };
  }
  return { ok: true, adAccountId, campaignId };
}
