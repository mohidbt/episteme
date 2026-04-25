import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import { proseMirrorToMd } from "@episteme/markdown";

// The "prosemirror" XmlFragment key matches the y-prosemirror default used by
// the client (set in Task 4). Don't rename — they have to agree.
export function yDocToPmJson(doc: Y.Doc): unknown {
  return yDocToProsemirrorJSON(doc, "prosemirror");
}

export function pmJsonToMd(pmJson: unknown): string {
  return proseMirrorToMd(pmJson as Parameters<typeof proseMirrorToMd>[0]);
}

export function yjsToMd(doc: Y.Doc): string {
  return pmJsonToMd(yDocToPmJson(doc));
}
