import "server-only";

const ENV_VAR = "D2C_TOKEN_KEY";

export class MissingD2CTokenKeyError extends Error {
  constructor() {
    super(
      `${ENV_VAR} is not set. Add it to .env.local and Vercel before saving or sending D2C connections.`,
    );
    this.name = "MissingD2CTokenKeyError";
  }
}

export function getD2CTokenKey(): string {
  const value = process.env[ENV_VAR];
  if (!value || value.length < 8) {
    throw new MissingD2CTokenKeyError();
  }
  return value;
}

export function tryGetD2CTokenKey(): string | null {
  const value = process.env[ENV_VAR];
  if (!value || value.length < 8) return null;
  return value;
}
