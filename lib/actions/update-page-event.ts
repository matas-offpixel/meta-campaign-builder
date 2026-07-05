"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireClientContext } from "@/lib/auth/get-client-context";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  buildAssetPath,
  buildEventUpdate,
  buildPageEventUpdate,
  moveImage,
  parseImageList,
  parsePageEventForm,
  slugifyEventName,
  MAX_ASSET_BYTES,
  type AssetKind,
  type PageEventActionState,
} from "@/lib/admin/page-event-schema";
import { rebuildModulesFromLegacy } from "@/lib/admin/page-modules-sync";

/**
 * Regenerate the modules array from the (post-mutation) legacy values so the
 * /l renderer — which reads page_events.modules after migration 139 — always
 * reflects the editor. Brand socials + YouTube come from the row's content /
 * youtube_url; hero/bottom lists are passed in already-updated.
 */
function modulesFor(
  content: Record<string, unknown>,
  youtubeUrl: string | null,
  heroImages: string[],
  bottomImages: string[],
): Record<string, unknown> {
  const asStr = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  return {
    modules: rebuildModulesFromLegacy({
      heroImages,
      youtubeUrl,
      bottomImages,
      brandInstagramUrl: asStr(content.brand_instagram_url),
      brandTiktokUrl: asStr(content.brand_tiktok_url),
    }),
  };
}

/**
 * lib/actions/update-page-event.ts
 *
 * Server actions for the landing-page CRUD (OP909 Phase 3). Scope
 * contract (docs/ADMIN_DASHBOARD_ARCHITECTURE.md §6): every action calls
 * requireClientContext() FIRST, then verifies the target page/event
 * belongs to that client_id via `resolveOwnedPage` before touching it —
 * page ids arriving from the form are UNTRUSTED.
 *
 * Writes are service-role (member RLS is SELECT-only). Events created
 * here are stamped with the OWNING OPERATOR's user_id (clients.user_id)
 * so operator dashboards keep seeing them; provider is 'internal' —
 * pages born in this dashboard render on the internal renderer, not
 * Evntree.
 */

type PageActionState = PageEventActionState;

type Db = ReturnType<typeof createServiceRoleClient>;

interface OwnedPage {
  pageEventId: string;
  eventId: string;
  content: Record<string, unknown>;
  heroImages: string[];
  bottomImages: string[];
  youtubeUrl: string | null;
}

/**
 * Resolve a page_events row AND prove it belongs to clientId in one
 * query (join through events.client_id). Null = not found OR not owned —
 * callers surface both identically (no existence oracle).
 */
async function resolveOwnedPage(
  db: Db,
  clientId: string,
  pageEventId: string,
): Promise<OwnedPage | null> {
  const { data, error } = await db
    .from("page_events")
    .select(
      "id, event_id, content, hero_images, bottom_images, youtube_url, events!inner (client_id)",
    )
    .eq("id", pageEventId)
    .eq("events.client_id", clientId)
    .maybeSingle();
  if (error) {
    throw new Error(`[admin-pages] ownership lookup failed: ${error.message}`);
  }
  if (!data) return null;
  const row = data as unknown as {
    id: string;
    event_id: string;
    content: Record<string, unknown> | null;
    hero_images: unknown;
    bottom_images: unknown;
    youtube_url: string | null;
  };
  return {
    pageEventId: row.id,
    eventId: row.event_id,
    content: row.content ?? {},
    heroImages: parseImageList(row.hero_images),
    bottomImages: parseImageList(row.bottom_images),
    youtubeUrl: row.youtube_url,
  };
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Flow (a): add a landing page to an existing event that has none.
 * Redirects into the editor on success.
 */
export async function createPageForExistingEvent(
  _prev: PageActionState,
  formData: FormData,
): Promise<PageActionState> {
  const membership = await requireClientContext();
  const eventId = String(formData.get("event_id") ?? "");
  if (!eventId) return { status: "error", errors: { _form: "Pick an event." } };

  const db = createServiceRoleClient();

  // Ownership: the event must belong to this client and have no page yet.
  const { data: event, error } = await db
    .from("events")
    .select("id, client_id, page_events (id)")
    .eq("id", eventId)
    .eq("client_id", membership.clientId)
    .maybeSingle();
  if (error) {
    return { status: "error", errors: { _form: `Lookup failed: ${error.message}` } };
  }
  if (!event) {
    return { status: "error", errors: { _form: "Event not found." } };
  }
  const existingPage = (event as { page_events: unknown }).page_events;
  const hasPage = Array.isArray(existingPage)
    ? existingPage.length > 0
    : existingPage != null;
  if (hasPage) {
    return {
      status: "error",
      errors: { _form: "That event already has a landing page." },
    };
  }

  const { data: created, error: insertError } = await db
    .from("page_events")
    .insert({ event_id: eventId, provider: "internal", status: "draft" })
    .select("id")
    .single();
  if (insertError || !created) {
    return {
      status: "error",
      errors: { _form: `Create failed: ${insertError?.message ?? "no row"}` },
    };
  }

  redirect(`/admin/${membership.clientSlug}/pages/${created.id}/edit`);
}

/**
 * Flow (b): create a new event + its landing page together. Minimal
 * fields here — everything else is edited on the editor it redirects to.
 */
export async function createEventWithPage(
  _prev: PageActionState,
  formData: FormData,
): Promise<PageActionState> {
  const membership = await requireClientContext();

  const parsed = parsePageEventForm({
    name: formData.get("name"),
    slug: formData.get("slug"),
    presale_at: formData.get("presale_at"),
    general_sale_at: formData.get("general_sale_at"),
    event_start_at: formData.get("event_start_at"),
    venue: formData.get("venue"),
    venue_short: formData.get("venue_short"),
    status: "draft",
  });
  if (!parsed.ok) return { status: "error", errors: parsed.errors };
  const values = parsed.value;

  const db = createServiceRoleClient();

  // events.user_id is NOT NULL — stamp the owning operator's id so the
  // internal dashboards keep seeing client-created events.
  const { data: clientRow, error: clientError } = await db
    .from("clients")
    .select("user_id")
    .eq("id", membership.clientId)
    .single();
  if (clientError || !clientRow) {
    return {
      status: "error",
      errors: { _form: `Client lookup failed: ${clientError?.message ?? "no row"}` },
    };
  }

  // Slug collision under this operator → suffix (events_slug_unique_per_user).
  let slug = values.slug || slugifyEventName(values.name);
  const { data: clash } = await db
    .from("events")
    .select("id")
    .eq("user_id", clientRow.user_id)
    .eq("slug", slug)
    .maybeSingle();
  if (clash) slug = `${slug}-${Date.now().toString(36)}`.slice(0, 64);

  const { data: event, error: eventError } = await db
    .from("events")
    .insert({
      user_id: clientRow.user_id,
      client_id: membership.clientId,
      name: values.name,
      slug,
      presale_at: values.presale_at,
      general_sale_at: values.general_sale_at,
      event_start_at: values.event_start_at,
    })
    .select("id")
    .single();
  if (eventError || !event) {
    return {
      status: "error",
      errors: { _form: `Event create failed: ${eventError?.message ?? "no row"}` },
    };
  }

  const content: Record<string, unknown> = {};
  if (values.venue) content.venue = values.venue;
  if (values.venue_short) content.venue_short = values.venue_short;
  content.title = values.name;

  const { data: page, error: pageError } = await db
    .from("page_events")
    .insert({
      event_id: event.id,
      provider: "internal",
      status: "draft",
      content,
    })
    .select("id")
    .single();
  if (pageError || !page) {
    return {
      status: "error",
      errors: { _form: `Page create failed: ${pageError?.message ?? "no row"}` },
    };
  }

  redirect(`/admin/${membership.clientSlug}/pages/${page.id}/edit`);
}

// ─── Save (edit form) ────────────────────────────────────────────────────────

/** Full editor save — event basics + content + countdown + status. */
export async function savePageEvent(
  _prev: PageActionState,
  formData: FormData,
): Promise<PageActionState> {
  const membership = await requireClientContext();
  const pageEventId = String(formData.get("page_event_id") ?? "");

  const parsed = parsePageEventForm({
    name: formData.get("name"),
    slug: formData.get("slug"),
    presale_at: formData.get("presale_at"),
    general_sale_at: formData.get("general_sale_at"),
    event_start_at: formData.get("event_start_at"),
    title: formData.get("title"),
    subtitle: formData.get("subtitle"),
    description: formData.get("description"),
    venue: formData.get("venue"),
    venue_short: formData.get("venue_short"),
    youtube_url: formData.get("youtube_url"),
    brand_instagram_url: formData.get("brand_instagram_url"),
    brand_tiktok_url: formData.get("brand_tiktok_url"),
    confirmation_body: formData.get("confirmation_body"),
    confirmation_cta_label: formData.get("confirmation_cta_label"),
    confirmation_cta_url: formData.get("confirmation_cta_url"),
    countdown_enabled: formData.get("countdown_enabled"),
    countdown_target_at: formData.get("countdown_target_at"),
    countdown_label: formData.get("countdown_label"),
    show_event_date: formData.get("show_event_date"),
    show_venue: formData.get("show_venue"),
    show_description: formData.get("show_description"),
    primary_button_bg: formData.get("primary_button_bg"),
    primary_button_text: formData.get("primary_button_text"),
    description_align: formData.get("description_align"),
    status: formData.get("status"),
  });
  if (!parsed.ok) return { status: "error", errors: parsed.errors };

  const db = createServiceRoleClient();
  const owned = await resolveOwnedPage(db, membership.clientId, pageEventId);
  if (!owned) {
    return { status: "error", errors: { _form: "Page not found." } };
  }

  const { error: eventError } = await db
    .from("events")
    .update(buildEventUpdate(parsed.value))
    .eq("id", owned.eventId);
  if (eventError) {
    return {
      status: "error",
      errors: { _form: `Event save failed: ${eventError.message}` },
    };
  }

  // The form owns youtube_url + brand socials; hero/bottom lists are managed
  // by the image actions, so rebuild modules from the form's new
  // youtube/brand values merged into the row's unchanged content + images.
  const pageUpdate = buildPageEventUpdate(owned.content, parsed.value);
  const mergedContent = (pageUpdate.content ?? owned.content) as Record<
    string,
    unknown
  >;
  const { error: pageError } = await db
    .from("page_events")
    .update({
      ...pageUpdate,
      ...modulesFor(
        mergedContent,
        parsed.value.youtube_url,
        owned.heroImages,
        owned.bottomImages,
      ),
    })
    .eq("id", owned.pageEventId);
  if (pageError) {
    return {
      status: "error",
      errors: { _form: `Page save failed: ${pageError.message}` },
    };
  }

  revalidatePath(`/admin/${membership.clientSlug}/pages`);
  revalidatePath(
    `/admin/${membership.clientSlug}/pages/${owned.pageEventId}/edit`,
  );
  return { status: "saved", errors: {} };
}

// ─── Archive (soft delete) ───────────────────────────────────────────────────

export async function archivePage(formData: FormData): Promise<void> {
  const membership = await requireClientContext();
  const pageEventId = String(formData.get("page_event_id") ?? "");

  const db = createServiceRoleClient();
  const owned = await resolveOwnedPage(db, membership.clientId, pageEventId);
  if (!owned) return;

  const { error } = await db
    .from("page_events")
    .update({ status: "archived" })
    .eq("id", owned.pageEventId);
  if (error) {
    throw new Error(`[admin-pages] archive failed: ${error.message}`);
  }
  revalidatePath(`/admin/${membership.clientSlug}/pages`);
}

// ─── Image uploads ───────────────────────────────────────────────────────────

const BUCKET = "landing-page-assets";

/**
 * Upload one image (artwork | hero | bottom). Artwork replaces
 * content.artwork_url AND clears artwork_palette so the /l renderer's
 * lazy pipeline re-extracts on next view (PR #670 contract). Hero/bottom
 * append to their ordered lists.
 */
export async function uploadPageImage(
  _prev: PageActionState,
  formData: FormData,
): Promise<PageActionState> {
  const membership = await requireClientContext();
  const pageEventId = String(formData.get("page_event_id") ?? "");
  const kind = String(formData.get("kind") ?? "") as AssetKind;
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", errors: { _image: "Choose an image file." } };
  }
  if (file.size > MAX_ASSET_BYTES) {
    return { status: "error", errors: { _image: "Max image size is 10 MB." } };
  }

  const db = createServiceRoleClient();
  const owned = await resolveOwnedPage(db, membership.clientId, pageEventId);
  if (!owned) {
    return { status: "error", errors: { _image: "Page not found." } };
  }

  const pathResult = buildAssetPath(
    membership.clientId,
    owned.pageEventId,
    kind,
    file.type,
  );
  if (!pathResult.ok) {
    return { status: "error", errors: { _image: pathResult.error } };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(pathResult.path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) {
    return {
      status: "error",
      errors: { _image: `Upload failed: ${uploadError.message}` },
    };
  }

  const {
    data: { publicUrl },
  } = db.storage.from(BUCKET).getPublicUrl(pathResult.path);

  let heroImages = owned.heroImages;
  let bottomImages = owned.bottomImages;
  let content = owned.content;
  let update: Record<string, unknown>;
  if (kind === "artwork") {
    content = { ...owned.content, artwork_url: publicUrl };
    update = {
      content,
      artwork_palette: null, // lazy pipeline re-extracts on next /l render
    };
  } else if (kind === "hero") {
    heroImages = [...owned.heroImages, publicUrl];
    update = { hero_images: heroImages };
  } else {
    bottomImages = [...owned.bottomImages, publicUrl];
    update = { bottom_images: bottomImages };
  }
  update = {
    ...update,
    ...modulesFor(content, owned.youtubeUrl, heroImages, bottomImages),
  };

  const { error: writeError } = await db
    .from("page_events")
    .update(update)
    .eq("id", owned.pageEventId);
  if (writeError) {
    return {
      status: "error",
      errors: { _image: `Save failed: ${writeError.message}` },
    };
  }

  revalidatePath(
    `/admin/${membership.clientSlug}/pages/${owned.pageEventId}/edit`,
  );
  return { status: "saved", errors: {} };
}

/** Remove one image URL from a list (or clear artwork). */
export async function removePageImage(formData: FormData): Promise<void> {
  const membership = await requireClientContext();
  const pageEventId = String(formData.get("page_event_id") ?? "");
  const kind = String(formData.get("kind") ?? "") as AssetKind;
  const url = String(formData.get("url") ?? "");

  const db = createServiceRoleClient();
  const owned = await resolveOwnedPage(db, membership.clientId, pageEventId);
  if (!owned) return;

  let heroImages = owned.heroImages;
  let bottomImages = owned.bottomImages;
  let content = owned.content;
  let update: Record<string, unknown>;
  if (kind === "artwork") {
    content = { ...owned.content };
    delete content.artwork_url;
    update = { content, artwork_palette: null };
  } else if (kind === "hero") {
    heroImages = owned.heroImages.filter((u) => u !== url);
    update = { hero_images: heroImages };
  } else if (kind === "bottom") {
    bottomImages = owned.bottomImages.filter((u) => u !== url);
    update = { bottom_images: bottomImages };
  } else {
    return;
  }
  update = {
    ...update,
    ...modulesFor(content, owned.youtubeUrl, heroImages, bottomImages),
  };

  const { error } = await db
    .from("page_events")
    .update(update)
    .eq("id", owned.pageEventId);
  if (error) throw new Error(`[admin-pages] image remove failed: ${error.message}`);

  revalidatePath(
    `/admin/${membership.clientSlug}/pages/${owned.pageEventId}/edit`,
  );
}

/** Reorder: move an image one slot up/down in its list. */
export async function reorderPageImage(formData: FormData): Promise<void> {
  const membership = await requireClientContext();
  const pageEventId = String(formData.get("page_event_id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const url = String(formData.get("url") ?? "");
  const direction = formData.get("direction") === "up" ? "up" : "down";

  if (kind !== "hero" && kind !== "bottom") return;

  const db = createServiceRoleClient();
  const owned = await resolveOwnedPage(db, membership.clientId, pageEventId);
  if (!owned) return;

  const list = kind === "hero" ? owned.heroImages : owned.bottomImages;
  const next = moveImage(list, url, direction);
  const heroImages = kind === "hero" ? next : owned.heroImages;
  const bottomImages = kind === "bottom" ? next : owned.bottomImages;
  const update = {
    ...(kind === "hero" ? { hero_images: next } : { bottom_images: next }),
    ...modulesFor(owned.content, owned.youtubeUrl, heroImages, bottomImages),
  };

  const { error } = await db
    .from("page_events")
    .update(update)
    .eq("id", owned.pageEventId);
  if (error) throw new Error(`[admin-pages] reorder failed: ${error.message}`);

  revalidatePath(
    `/admin/${membership.clientSlug}/pages/${owned.pageEventId}/edit`,
  );
}
