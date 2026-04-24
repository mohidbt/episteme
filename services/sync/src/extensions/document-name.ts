const NOTE_DOC_RE = /^note:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Parse a Hocuspocus documentName of the form `note:<uuid>`.
 * Returns the UUID string on success, or null if the format doesn't match.
 */
export function parseNoteDocumentName(documentName: string): string | null {
  const match = documentName.match(NOTE_DOC_RE);
  return match ? match[1] : null;
}
