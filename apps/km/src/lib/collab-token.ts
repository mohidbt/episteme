import { SignJWT } from "jose";

/**
 * Mint a short-lived Hocuspocus JWT for the given userId.
 * Used by both the /api/collab/token route handler AND the server component
 * for the note page (SSR token to eliminate the client-side round-trip).
 */
export async function mintCollabToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.BETTER_AUTH_SECRET);
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(secret);
}
