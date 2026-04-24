import { Node, mergeAttributes } from "@tiptap/core";

export interface PdfEmbedAttrs {
  pdfId: string;
  title: string;
  page: number | null;
}

// Minimal block-ruler state type we use in the setup hook.
interface MdBlockState {
  src: string;
  pos: number;
  lineMax: number;
  line: number;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  push(type: string, tag: string, nesting: number): MdBlockToken;
}

interface MdBlockToken {
  meta: unknown;
  block?: boolean;
  map?: [number, number];
}

interface MdBlockRuler {
  before(
    before: string,
    name: string,
    rule: (state: MdBlockState, startLine: number, endLine: number, silent: boolean) => boolean,
    options?: object,
  ): void;
}

interface MdWithBlock {
  block: { ruler: MdBlockRuler };
  renderer: { rules: Record<string, (tokens: MdBlockToken[], idx: number) => string> };
  utils: { escapeHtml: (s: string) => string };
}

/**
 * Block-level atom node for embedded PDFs.
 * MD serializes to: <!-- episteme:pdf id="..." title="..." page="..." -->
 * MD parses via a block-level markdown-it rule.
 */
export const PdfEmbed = Node.create({
  name: "pdfEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      pdfId: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-pdf-id") ?? "",
        renderHTML: (attrs) => ({ "data-pdf-id": attrs.pdfId }),
      },
      title: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-title") ?? "",
        renderHTML: (attrs) => ({ "data-title": attrs.title }),
      },
      page: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-page");
          if (!raw) return null;
          const n = parseInt(raw, 10);
          return isNaN(n) ? null : n;
        },
        renderHTML: (attrs) =>
          attrs.page != null ? { "data-page": String(attrs.page) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="pdf-embed"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as PdfEmbedAttrs;
    const href = attrs.page != null
      ? `/read/${attrs.pdfId}#page=${attrs.page}`
      : `/read/${attrs.pdfId}`;

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "pdf-embed",
        class: "pdf-embed",
      }),
      ["div", { class: "pdf-embed-thumb" }],
      ["div", { class: "pdf-embed-title" }, attrs.title],
      [
        "a",
        { href, class: "pdf-embed-open" },
        "Open in reader",
      ],
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void },
          node: { attrs: PdfEmbedAttrs },
        ) {
          const { pdfId, title, page } = node.attrs;
          // Escape " as &quot; so the comment survives round-trip
          const escapedTitle = title.replace(/"/g, "&quot;");
          const pageStr = page != null ? ` page="${page}"` : "";
          state.write(
            `<!-- episteme:pdf id="${pdfId}" title="${escapedTitle}"${pageStr} -->`,
          );
          // Block-level nodes need a trailing newline
          state.write("\n");
        },
        parse: {
          setup(md: MdWithBlock) {
            const TOKEN = "pdf_embed";
            const COMMENT_RE =
              /^<!--\s*episteme:pdf\s+id="([^"]+)"\s+title="([^"]*)"\s*(?:page="(\d+)")?\s*-->/;

            md.block.ruler.before(
              "paragraph",
              TOKEN,
              (state, startLine, _endLine, silent) => {
                const lineStart = state.bMarks[startLine] + state.tShift[startLine];
                const lineEnd = state.eMarks[startLine];
                const lineText = state.src.slice(lineStart, lineEnd);

                const match = COMMENT_RE.exec(lineText);
                if (!match) return false;
                if (silent) return true;

                const [, pdfId, rawTitle, rawPage] = match;
                const title = rawTitle.replace(/&quot;/g, '"');
                const page = rawPage != null ? parseInt(rawPage, 10) : null;

                const token = state.push(TOKEN, "", 0);
                (token as { meta: { pdfId: string; title: string; page: number | null } }).meta = {
                  pdfId,
                  title,
                  page,
                };
                token.block = true;
                token.map = [startLine, startLine + 1];

                state.line = startLine + 1;
                return true;
              },
              { alt: ["paragraph"] },
            );

            md.renderer.rules[TOKEN] = (tokens, idx) => {
              const { pdfId, title, page } = (
                tokens[idx] as unknown as {
                  meta: { pdfId: string; title: string; page: number | null };
                }
              ).meta;
              const safeId = md.utils.escapeHtml(pdfId);
              const safeTitle = md.utils.escapeHtml(title);
              const pageAttr = page != null ? ` data-page="${page}"` : "";
              return `<div data-type="pdf-embed" data-pdf-id="${safeId}" data-title="${safeTitle}"${pageAttr}></div>\n`;
            };
          },
        },
      },
    };
  },
});
