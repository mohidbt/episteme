import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import { proseMirrorToMd } from "@episteme/markdown";

/**
 * Serialize a Y.Doc to markdown using the "prosemirror" XmlFragment key
 * (matches the y-prosemirror default used by the client in Task 4).
 */
export function yjsToMd(doc: Y.Doc): string {
  const pmJson = yDocToProsemirrorJSON(doc, "prosemirror");
  return proseMirrorToMd(pmJson);
}
