import { Extension, InputRule } from "@tiptap/core";

/**
 * Markdown shortcut: typing `[]` or `[ ]` at the start of an empty paragraph
 * followed by a space converts the line into an unchecked TaskItem inside a
 * TaskList — mirroring how `- ` triggers a bullet list.
 *
 * Variant `[x] ` / `[X] ` produces a checked TaskItem.
 *
 * Implemented as a standalone Extension so we don't have to fork the
 * `@tiptap/extension-task-list` package; it relies on the `taskList`/`taskItem`
 * node types already registered by `@episteme/markdown`'s createExtensions.
 */
export const TaskListShortcut = Extension.create({
  name: "taskListShortcut",

  addInputRules() {
    return [
      new InputRule({
        find: /^\[( |x|X)?\]\s$/,
        handler: ({ state, range, match, chain }) => {
          const checked = match[1]?.toLowerCase() === "x";
          const taskList = state.schema.nodes.taskList;
          const taskItem = state.schema.nodes.taskItem;
          if (!taskList || !taskItem) return null;

          // Only fire if the cursor is in a top-level paragraph that contains
          // ONLY the trigger text — same constraint as Tiptap's built-in
          // bullet-list input rule. Prevents the shortcut firing mid-paragraph.
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== "paragraph") return null;
          if ($from.depth !== 1) return null;

          const node = taskList.create(
            null,
            taskItem.create({ checked }, state.schema.nodes.paragraph.create()),
          );

          chain()
            .command(({ tr }) => {
              tr.replaceRangeWith($from.before($from.depth), $from.after($from.depth), node);
              return true;
            })
            .run();
          return null;
        },
      }),
    ];
  },
});
