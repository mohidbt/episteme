"use client";

/**
 * @deprecated Use `@/lib/drive-sync` instead. Kept as a thin re-export so the
 * three legacy call sites (DetailUploadBar, ReferenceImportButton,
 * ReferenceDoiInput) keep working until they're migrated.
 */
export { invalidateDriveTree as invalidateTree, useDriveSync as useTreeInvalidation } from "./drive-sync";
