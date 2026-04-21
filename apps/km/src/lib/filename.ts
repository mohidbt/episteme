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
