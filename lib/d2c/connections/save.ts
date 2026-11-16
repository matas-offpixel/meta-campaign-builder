/**
 * lib/d2c/connections/save.ts
 *
 * The POST /api/d2c/connections flow, with its reads and writes passed in
 * so it can be tested without Supabase or a provider. The route wires the
 * real ones.
 *
 * Bird needs a workspace id: the save check (`BirdProvider.validateCredentials`)
 * and the HE3 nightly stats ingest both read `credentials.workspace_id`. The
 * id is checked for shape here before any Bird call, and a workspace already
 * saved on another client's active Bird connection is refused: the ingest
 * reads a workspace once, and a workspace two clients share comes out
 * unattributed.
 *
 * Credentials never come back in a response: every connection returned has
 * `credentials: null`, and no error message echoes a submitted value.
 */

import type {
  D2CConnection,
  D2CProviderName,
  ValidateD2CCredentialsResult,
} from "../types.ts";

/** A Bird workspace id is a UUID. */
export const BIRD_WORKSPACE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const BIRD_WORKSPACE_ID_REQUIRED = "Workspace id is required.";
export const BIRD_WORKSPACE_ID_SHAPE =
  "Workspace id must be a UUID, like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.";

/**
 * The other client is named to operators only; anyone else reads "another
 * client" even when the name is known. Decided by the caller's role, never by
 * whether a name was found.
 */
export function birdWorkspaceTaken(clientName: string | null, callerIsOperator: boolean): string {
  const where = callerIsOperator && clientName ? clientName : "another client";
  return `This Bird workspace is already saved on ${where}. A workspace can be saved on one client only, so each send is tied to one client.`;
}

export const BIRD_WORKSPACE_CHECK_FAILED =
  "Couldn't check whether this Bird workspace is saved on another client, so nothing was saved. Try again.";

export type BirdWorkspaceCheck =
  | { ok: true; workspaceId: string }
  | { ok: false; error: string };

/** Trims and lower-cases the id; blank → required, bad shape → shape error. */
export function checkBirdWorkspaceId(raw: unknown): BirdWorkspaceCheck {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return { ok: false, error: BIRD_WORKSPACE_ID_REQUIRED };
  if (!BIRD_WORKSPACE_ID_RE.test(v)) return { ok: false, error: BIRD_WORKSPACE_ID_SHAPE };
  return { ok: true, workspaceId: v.toLowerCase() };
}

export interface WorkspaceOwner {
  client_id: string;
  client_name: string | null;
}

export interface SaveConnectionDeps {
  /** The client row, or null when it isn't there. Throws on a read error. */
  findClient(clientId: string): Promise<{ id: string } | null>;
  validate(
    provider: D2CProviderName,
    credentials: Record<string, unknown>,
  ): Promise<ValidateD2CCredentialsResult>;
  /** Clients with an active Bird connection on this workspace (any user). */
  findBirdWorkspaceOwners(workspaceId: string): Promise<WorkspaceOwner[]>;
  upsert(input: {
    clientId: string;
    provider: D2CProviderName;
    credentials: Record<string, unknown>;
    externalAccountId: string | null;
  }): Promise<D2CConnection | null>;
}

export type PublicConnection = Omit<D2CConnection, "credentials"> & { credentials: null };

export type SaveConnectionResult =
  | { status: 201; body: { ok: true; connection: PublicConnection } }
  | { status: 400 | 404 | 409 | 500; body: { ok: false; error: string } };

function fail(status: 400 | 404 | 409 | 500, error: string): SaveConnectionResult {
  return { status, body: { ok: false, error } };
}

export async function saveD2CConnection(
  deps: SaveConnectionDeps,
  input: {
    body: unknown;
    allowedProviders: readonly D2CProviderName[];
    /** Operators see the other client's name on a workspace clash. */
    callerIsOperator: boolean;
  },
): Promise<SaveConnectionResult> {
  const body = (input.body && typeof input.body === "object" ? input.body : {}) as Record<string, unknown>;
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const provider = body.provider as D2CProviderName | undefined;
  const submitted =
    body.credentials && typeof body.credentials === "object"
      ? (body.credentials as Record<string, unknown>)
      : null;

  if (!clientId) return fail(400, "clientId is required");
  if (!provider || !input.allowedProviders.includes(provider)) {
    return fail(400, `provider must be one of: ${input.allowedProviders.join(", ")}`);
  }
  if (!submitted) return fail(400, "credentials object is required");

  const credentials = { ...submitted };
  if (provider === "bird") {
    const ws = checkBirdWorkspaceId(credentials.workspace_id);
    if (!ws.ok) return fail(400, ws.error);
    credentials.workspace_id = ws.workspaceId;
  }

  let client: { id: string } | null;
  try {
    client = await deps.findClient(clientId);
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "Client read failed.");
  }
  if (!client) return fail(404, "Client not found");

  if (provider === "bird") {
    let owners: WorkspaceOwner[];
    try {
      owners = await deps.findBirdWorkspaceOwners(credentials.workspace_id as string);
    } catch {
      return fail(500, BIRD_WORKSPACE_CHECK_FAILED);
    }
    const other = owners.find((o) => o.client_id !== clientId);
    if (other) return fail(409, birdWorkspaceTaken(other.client_name, input.callerIsOperator));
  }

  const validation = await deps.validate(provider, credentials);
  if (!validation.ok) {
    return fail(400, validation.error ?? "Provider rejected the credentials.");
  }

  const connection = await deps.upsert({
    clientId,
    provider,
    credentials,
    externalAccountId: validation.externalAccountId ?? null,
  });
  if (!connection) return fail(500, "Failed to persist the connection.");
  return { status: 201, body: { ok: true, connection: { ...connection, credentials: null } } };
}
