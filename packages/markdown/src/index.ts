export { mdToProseMirror } from "./md-to-prosemirror";
export { proseMirrorToMd } from "./prosemirror-to-md";
export { unescapeLegacyMd } from "./unescape-legacy-md";
export { createExtensions } from "./extensions";
export { extractLinks, extractTags } from "./wiki-link-regex";
export {
  buildMarkdownWithFrontmatter,
  inferType,
  parseFrontmatter,
  parseFrontmatterRows,
  serializeFrontmatterRows,
  splitFrontmatter,
} from "./frontmatter";
export type { FrontmatterRow, FrontmatterValue } from "./frontmatter";
export { WikiLink } from "./tiptap/WikiLink";
export { TagMark } from "./tiptap/TagMark";
export { Citation } from "./tiptap/Citation";
export type { CitationAttrs } from "./tiptap/Citation";
export { PdfEmbed } from "./tiptap/PdfEmbed";
export type { PdfEmbedAttrs } from "./tiptap/PdfEmbed";
export type { JSONContent } from "@tiptap/core";
export type { Link } from "./wiki-link-regex";
export type { WikiLinkAttrs, WikiLinkTargetKind } from "./tiptap/WikiLink";

/** Shared field name for the Yjs XmlFragment used by y-prosemirror and Hocuspocus. */
export const Y_PROSEMIRROR_FIELD = "prosemirror";
