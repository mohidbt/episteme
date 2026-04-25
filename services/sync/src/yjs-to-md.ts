import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import { proseMirrorToMd, Y_PROSEMIRROR_FIELD } from "@episteme/markdown";

export function yDocToPmJson(doc: Y.Doc): unknown {
  return yDocToProsemirrorJSON(doc, Y_PROSEMIRROR_FIELD);
}

export function pmJsonToMd(pmJson: unknown): string {
  return proseMirrorToMd(pmJson as Parameters<typeof proseMirrorToMd>[0]);
}

export function yjsToMd(doc: Y.Doc): string {
  return pmJsonToMd(yDocToPmJson(doc));
}
