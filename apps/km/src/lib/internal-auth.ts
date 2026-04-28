/**
 * Re-export of the canonical internal-auth helpers from `@episteme/auth/internal`.
 *
 * This shim exists so legacy `@/lib/internal-auth` imports keep working. New
 * code should import directly from `@episteme/auth/internal`.
 */
export {
  verifyInternalAuth,
  getAuthedUserId,
  MissingInternalSecretError,
  type InternalAuthResult,
  type AuthedUser,
} from "@episteme/auth/internal";
