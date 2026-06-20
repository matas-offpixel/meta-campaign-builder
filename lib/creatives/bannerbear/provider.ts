/**
 * lib/creatives/bannerbear/provider.ts
 *
 * Bannerbear v2 image API. Requires `BANNERBEAR_API_KEY` and
 * `FEATURE_BANNERBEAR=true` for all operations.
 */

import {
  CreativeProviderDisabledError,
  isBannerbearEnabled,
  type CreativeProvider,
  type CreativeFieldDescriptor,
  type CreativeRenderStatus,
  type CreativeTemplate,
  type ProviderTemplateSummary,
  type RenderJob,
} from "../types.ts";

const BB_BASE = "https://api.bannerbear.com/v2";
const FETCH_TIMEOUT_MS = 10_000;
const DISABLED =
  "Bannerbear is gated behind FEATURE_BANNERBEAR — pending account provisioning.";

type BannerbearModification = {
  name: string;
  text?: string;
  image_url?: string;
};

/** Exported for unit tests. */
export function buildBannerbearModifications(
  template: CreativeTemplate,
  fields: Record<string, unknown>,
): BannerbearModification[] {
  const byKey = new Map<string, CreativeFieldDescriptor>(
    (template.fields_jsonb ?? []).map((d) => [d.key, d]),
  );
  const out: BannerbearModification[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const desc = byKey.get(key);
    const type = desc?.type ?? "text";
    if (type === "image") {
      out.push({ name: key, image_url: String(value) });
    } else {
      out.push({ name: key, text: String(value) });
    }
  }
  return out;
}

function parseJsonArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.templates)) return o.templates;
    if (Array.isArray(o.data)) return o.data;
  }
  return [];
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

function mapImageStatus(
  raw: string | null | undefined,
): "rendering" | "done" | "failed" {
  const s = (raw ?? "").toLowerCase();
  if (s === "pending" || s === "processing" || s === "generating")
    return "rendering";
  if (s === "completed" || s === "complete" || s === "finished") return "done";
  if (s === "failed" || s === "error" || s === "errored") return "failed";
  return "rendering";
}

export class BannerbearProvider implements CreativeProvider {
  readonly name = "bannerbear" as const;
  private readonly apiKey: string;

  constructor() {
    const key = process.env.BANNERBEAR_API_KEY?.trim() ?? "";
    if (!key) {
      throw new CreativeProviderDisabledError(
        "bannerbear",
        "BANNERBEAR_API_KEY is not set or is empty.",
      );
    }
    this.apiKey = key;
  }

  async listTemplates(): Promise<ProviderTemplateSummary[]> {
    if (!isBannerbearEnabled()) {
      throw new CreativeProviderDisabledError("bannerbear", DISABLED);
    }
    const res = await fetchWithTimeout(`${BB_BASE}/templates`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(
        `Bannerbear listTemplates failed (${res.status}): ${errBody.slice(0, 500)}`,
      );
    }
    const json: unknown = await res.json();
    const arr = parseJsonArray(json);
    return arr.map((t): ProviderTemplateSummary => {
      const row = t as Record<string, unknown>;
      const uid = String(
        row.uid ??
          row.id ??
          (row as { template_uid?: string }).template_uid ??
          "",
      );
      const name = String(row.name ?? "Untitled");
      const preview =
        (typeof row.preview_url === "string" && row.preview_url) ||
        (typeof row.published_preview_url === "string" &&
          row.published_preview_url) ||
        null;
      return {
        externalTemplateId: uid,
        name,
        thumbnailUrl: preview,
      };
    });
  }

  async render(
    template: CreativeTemplate,
    fields: Record<string, unknown>,
  ): Promise<{ jobId: string; status: CreativeRenderStatus }> {
    if (!isBannerbearEnabled()) {
      throw new CreativeProviderDisabledError("bannerbear", DISABLED);
    }
    if (!template.external_template_id) {
      throw new Error("Template is missing external_template_id (Bannerbear uid).");
    }
    const modifications = buildBannerbearModifications(template, fields);
    const res = await fetchWithTimeout(`${BB_BASE}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        template: template.external_template_id,
        modifications,
        webhook_url: null,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(
        `Bannerbear create image failed (${res.status}): ${errBody.slice(0, 500)}`,
      );
    }
    const json = (await res.json()) as Record<string, unknown>;
    const uid = String(
      json.uid ??
        json.id ??
        (json as { image_uid?: string }).image_uid ??
        "",
    );
    if (!uid) {
      throw new Error("Bannerbear did not return an image uid.");
    }
    return { jobId: uid, status: "rendering" };
  }

  async pollRender(jobId: string): Promise<RenderJob> {
    if (!isBannerbearEnabled()) {
      throw new CreativeProviderDisabledError("bannerbear", DISABLED);
    }
    const res = await fetchWithTimeout(
      `${BB_BASE}/images/${encodeURIComponent(jobId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(
        `Bannerbear poll image failed (${res.status}): ${errBody.slice(0, 500)}`,
      );
    }
    const json = (await res.json()) as Record<string, unknown>;
    const statusStr = typeof json.status === "string" ? json.status : "";
    const mapped = mapImageStatus(statusStr);

    const imageUrlPng = json.image_url_png;
    const assetUrl =
      typeof imageUrlPng === "string" && imageUrlPng.length > 0
        ? imageUrlPng
        : undefined;

    const errMsg = json.error_message;
    const errorMessage =
      typeof errMsg === "string" && errMsg.length > 0
        ? errMsg
        : typeof json.error === "string"
          ? json.error
          : null;

    if (mapped === "done") {
      return { jobId, status: "done", assetUrl: assetUrl ?? null, errorMessage: null };
    }
    if (mapped === "failed") {
      return { jobId, status: "failed", assetUrl: null, errorMessage };
    }
    return { jobId, status: "rendering", assetUrl: null, errorMessage: null };
  }
}

let _bannerbear: BannerbearProvider | null = null;

export function getBannerbearProvider(): BannerbearProvider {
  if (!_bannerbear) {
    _bannerbear = new BannerbearProvider();
  }
  return _bannerbear;
}
