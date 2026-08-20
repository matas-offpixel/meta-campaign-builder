export interface AudienceCatalogFailed {
  interests: boolean;
  behaviours: boolean;
  customAudiences: boolean;
  savedAudiences: boolean;
}

export const ALL_AUDIENCE_DIMENSIONS_FAILED: AudienceCatalogFailed = {
  interests: true,
  behaviours: true,
  customAudiences: true,
  savedAudiences: true,
};

export function tikTokAudienceAuthErrorBody(error: string): {
  ok: false;
  error: string;
  failed: AudienceCatalogFailed;
} {
  return {
    ok: false,
    error,
    failed: ALL_AUDIENCE_DIMENSIONS_FAILED,
  };
}

export function readAudienceCatalogState(json: {
  ok?: boolean;
  failed?: Partial<AudienceCatalogFailed> | boolean;
  error?: string;
}): {
  catalogFailed: AudienceCatalogFailed;
  warning: string | null;
} {
  if (json.ok === false) {
    return {
      catalogFailed: { ...ALL_AUDIENCE_DIMENSIONS_FAILED },
      warning: json.error ?? "TikTok audience data is unavailable.",
    };
  }
  const failed =
    json.failed && typeof json.failed === "object" ? json.failed : {};
  return {
    catalogFailed: {
      interests: Boolean(failed.interests),
      behaviours: Boolean(failed.behaviours),
      customAudiences: Boolean(failed.customAudiences),
      savedAudiences: Boolean(failed.savedAudiences),
    },
    warning: null,
  };
}

export function readAudienceDimensionFailed(json: {
  ok?: boolean;
  failed?: boolean | Record<string, boolean>;
  error?: string;
}): { failed: boolean; error: string | null } {
  if (json.ok === false) {
    return {
      failed: true,
      error: json.error ?? "TikTok audience data is unavailable.",
    };
  }
  return {
    failed: Boolean(json.failed),
    error: json.failed
      ? json.error ?? "TikTok audience data is unavailable."
      : null,
  };
}
