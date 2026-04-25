export { mdToProseMirror } from "./md-to-prosemirror";
export { proseMirrorToMd } from "./prosemirror-to-md";
export { createExtensions } from "./extensions";
export { extractLinks, extractTags } from "./wiki-link-regex";
export { WikiLink } from "./tiptap/WikiLink";
export { TagMark } from "./tiptap/TagMark";
export type { JSONContent } from "@tiptap/core";
export type { Link } from "./wiki-link-regex";
export type { WikiLinkAttrs, WikiLinkTargetKind } from "./tiptap/WikiLink";

/** Shared field name for the Yjs XmlFragment used by y-prosemirror and Hocuspocus. */
export const Y_PROSEMIRROR_FIELD = "prosemirror";
