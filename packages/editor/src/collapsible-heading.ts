/**
 * CollapsibleHeading — Obsidian-style fold/unfold of body content under a heading.
 *
 * Adds a `collapsed` boolean attribute to the heading node and a ProseMirror
 * plugin that decorates following sibling top-level blocks with
 * `display: none` until the next heading whose level is <= the collapsed
 * heading's level (i.e. equal-or-larger heading in the document outline).
 *
 * Toggling is exposed via the `toggleHeadingCollapsed` command (used by the
 * UI chevron in note views).
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const CollapsibleHeadingPluginKey = new PluginKey("collapsibleHeading");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    collapsibleHeading: {
      toggleHeadingCollapsed: (pos: number) => ReturnType;
    };
  }
}

export const CollapsibleHeading = Extension.create({
  name: "collapsibleHeading",

  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          collapsed: {
            default: false,
            parseHTML: (el) => el.getAttribute("data-collapsed") === "true",
            renderHTML: (attrs) =>
              attrs.collapsed ? { "data-collapsed": "true" } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      toggleHeadingCollapsed:
        (pos: number) =>
        ({ tr, state, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== "heading") return false;
          const next = !node.attrs.collapsed;
          if (dispatch) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed: next });
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: CollapsibleHeadingPluginKey,
        props: {
          decorations: (state) => {
            const decos: Decoration[] = [];
            const doc = state.doc;
            const topLevel: { node: any; pos: number }[] = [];
            doc.forEach((child, offset) => {
              topLevel.push({ node: child, pos: offset });
            });

            for (let i = 0; i < topLevel.length; i++) {
              const { node } = topLevel[i];
              if (node.type.name !== "heading" || !node.attrs.collapsed) continue;
              const level = node.attrs.level ?? 1;
              for (let j = i + 1; j < topLevel.length; j++) {
                const sibling = topLevel[j];
                if (
                  sibling.node.type.name === "heading" &&
                  (sibling.node.attrs.level ?? 1) <= level
                ) {
                  break;
                }
                decos.push(
                  Decoration.node(sibling.pos, sibling.pos + sibling.node.nodeSize, {
                    style: "display: none;",
                    "data-collapsed": "true",
                  }),
                );
              }
            }

            return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
