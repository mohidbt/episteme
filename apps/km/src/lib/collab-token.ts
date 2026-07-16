import { SignJWT } from "jose";

const COLLAB_JWT_ISSUER = "episteme-km";
const COLLAB_JWT_AUDIENCE = "episteme-sync";
const MIN_SECRET_BYTES = 32;

function jwtSecret(): Uint8Array {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || new TextEncoder().encode(value).byteLength < MIN_SECRET_BYTES) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 bytes");
  }
  return new TextEncoder().encode(value);
}

/**
 * Mint a short-lived Hocuspocus JWT for the given userId.
 * Used by both the /api/collab/token route handler AND the server component
 * for the note page (SSR token to eliminate the client-side round-trip).
 */
export async function mintCollabToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(COLLAB_JWT_ISSUER)
    .setAudience(COLLAB_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(jwtSecret());
}
