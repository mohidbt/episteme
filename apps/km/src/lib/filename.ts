// Pure string helpers for uploaded-filename hygiene. No PDF / canvas deps —
// safe to import from the init POST (pdf-extract drags in pdfjs + @napi-rs/canvas
// which we only want loaded on the finalize path).

const WIN_RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

const MAX_BASENAME_BYTES = 200;

/**
 * Sanitize an uploaded filename:
 *   - keep only the last path segment
 *   - strip C0/C1-ish ASCII control chars
 *   - prefix Windows-reserved basenames with "_"
 *   - cap the basename at 200 UTF-8 bytes, preserving a trailing `.pdf`
 *
 * Preserves unicode.
 */
export function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim();
  const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  let base = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;

  base = base.replace(/[\x00-\x1f\x7f]/g, "");

  const pdfMatch = base.match(/\.pdf$/i);
  const ext = pdfMatch ? pdfMatch[0] : "";
  let stem = ext ? base.slice(0, -ext.length) : base;

  if (WIN_RESERVED.has(stem.toUpperCase())) {
    stem = `_${stem}`;
  }

  while (Buffer.byteLength(stem, "utf8") > MAX_BASENAME_BYTES) {
    stem = stem.slice(0, -1);
  }

  return stem + ext;
}

/** Convert a raw filename into a fallback title: sanitize then drop a trailing .pdf. */
export function filenameToTitle(raw: string): string {
  const clean = sanitizeFilename(raw);
  return clean.replace(/\.pdf$/i, "");
}

/** Sanitize one ZIP path segment for safe extraction on POSIX and Windows. */
export function sanitizeArchiveSegment(raw: string, fallback = "item"): string {
  let value = raw
    .normalize("NFC")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    .replace(/[\\/:]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!value || value === "." || value === "..") value = fallback;
  value = sanitizeFilename(value) || fallback;
  return value === "." || value === ".." ? fallback : value;
}

/**
 * Build a relative ZIP entry path from an untrusted stored folder and leaf.
 * Absolute, traversal, and control-bearing folders are rejected rather than
 * normalized into a surprising extraction target.
 */
export function archiveRelativePath(
  folderPath: string,
  rawLeaf: string,
  fallbackLeaf = "item",
): string | null {
  const normalized = folderPath.normalize("NFC");
  if (
    /[\x00-\x1f\x7f-\x9f]/.test(normalized) ||
    /^[\\/]/.test(normalized) ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return null;
  }
  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  const safeSegments = segments.map((segment) =>
    sanitizeArchiveSegment(segment, "folder"),
  );
  safeSegments.push(sanitizeArchiveSegment(rawLeaf, fallbackLeaf));
  return safeSegments.join("/");
}

/**
 * Build an attachment header without letting a stored/user-supplied filename
 * escape the quoted parameter or inject another header. Include RFC 5987's
 * UTF-8 form so non-ASCII filenames remain readable in modern browsers.
 */
export function attachmentContentDisposition(raw: string): string {
  const sanitized = sanitizeFilename(raw).replace(/["\\]/g, "_") || "download";
  const asciiFallback = sanitized.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(sanitized).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
