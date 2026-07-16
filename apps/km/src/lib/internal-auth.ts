/**
 * Re-export of the canonical internal-auth helpers from `@episteme/auth/internal`.
 *
 * This shim exists so legacy `@/lib/internal-auth` imports keep working. New
 * code should import directly from `@episteme/auth/internal`.
 */
export {
  verifyInternalAuth,
  getAuthedUserId,
  canonicalInternalAuthPayload,
  INTERNAL_AUTH_SIGNATURE_VERSION,
  MissingInternalSecretError,
  type InternalAuthEnvelope,
  type InternalAuthResult,
  type AuthedUser,
} from "@episteme/auth/internal";
