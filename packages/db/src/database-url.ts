export type DatabaseEnvironment = Record<string, string | undefined>;

/**
 * Resolve the application database DSN without allowing a production
 * deployment to silently inherit the migration/owner credential.
 */
export function resolveAppDatabaseUrl(
  env: DatabaseEnvironment = process.env,
): { url: string; usedFallback: boolean } {
  const appUrl = env.APP_RUNTIME_DATABASE_URL?.trim();
  if (appUrl) return { url: appUrl, usedFallback: false };

  if (env.NODE_ENV === "production") {
    throw new Error(
      "APP_RUNTIME_DATABASE_URL is required in production; refusing to fall back to DATABASE_URL",
    );
  }

  const fallbackUrl = env.DATABASE_URL?.trim();
  if (!fallbackUrl) {
    throw new Error(
      "APP_RUNTIME_DATABASE_URL or DATABASE_URL is required outside production",
    );
  }

  return { url: fallbackUrl, usedFallback: true };
}
