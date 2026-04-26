import { unescapeLegacyMd } from "@episteme/markdown";

/**
 * Prepares note content MD for display.
 *
 * Legacy notes have defensive backslash-escapes from tiptap-markdown's
 * `esc()` serializer. We detect these by computing an "escape density"
 * (fraction of chars that are markdown-escape sequences). If density > 0.5%
 * we unescape the whole document so it renders correctly.
 *
 * @param contentMd - Raw markdown string from the database.
 * @returns Markdown string safe for parsing/display.
 */
export function prepareNoteContent(contentMd: string): string {
  if (!contentMd) return contentMd;

  const escapePattern = /\\[*_.\[\]()\#+\->|~`!]/g;
  const matches = contentMd.match(escapePattern);
  const escapeCount = matches?.length ?? 0;
  const density = escapeCount / Math.max(contentMd.length, 1);

  if (density > 0.005) {
    return unescapeLegacyMd(contentMd);
  }

  return contentMd;
}
