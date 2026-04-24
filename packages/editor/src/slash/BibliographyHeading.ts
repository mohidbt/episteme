import { Node, mergeAttributes } from "@tiptap/core";

/**
 * A minimal custom node that renders the bibliography section heading.
 *
 * Extends the base paragraph spec with a sentinel attribute
 * `data-bib-heading="true"` so bibliography detection in CiteCommand.ts
 * can scan for this marker structurally instead of matching plain text.
 *
 * Trade-off: on reload, tiptap-markdown will parse the serialized
 * "Bibliography" heading back as a plain paragraph (the node type won't
 * round-trip through markdown). That means the dedup sentinel is a
 * within-session guarantee only. A full fix (node persists across reload)
 * would require embedding the marker in the serialized markdown — left as
 * a known limitation for a follow-up.
 */
export const BibliographyHeading = Node.create({
  name: "bibliographyHeading",
  group: "block",
  content: "inline*",

  parseHTML() {
    return [{ tag: 'p[data-bib-heading="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "p",
      mergeAttributes(HTMLAttributes, { "data-bib-heading": "true" }),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; renderInline: (node: unknown) => void; closeBlock: (node: unknown) => void },
          node: unknown,
        ) {
          state.write("Bibliography");
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});
