import Placeholder from "@tiptap/extension-placeholder";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { createExtensions as baseExtensions, WikiLink, TagMark, Y_PROSEMIRROR_FIELD } from "@episteme/markdown";
import { BibliographyHeading } from "./slash/BibliographyHeading";
import { CodeBlockNodeView } from "./CodeBlockNodeView";
import { MdPaste } from "./MdPaste";
import { TaskListShortcut } from "./task-list-shortcut";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import GlobalDragHandle from "tiptap-extension-global-drag-handle";
import FileHandler from "@tiptap/extension-file-handler";
import { Mathematics, defaultShouldRender } from "@tiptap/extension-mathematics";
import { CollapsibleHeading } from "./collapsible-heading";
import type * as Y from "yjs";
import type { HocuspocusProvider } from "@hocuspocus/provider";

export interface FileUploadOptions {
  /** Mime types accepted; defaults to common image types. */
  allowedMimeTypes?: string[];
  /** Called when the user drops files into the editor. */
  onDrop?: (editor: import("@tiptap/core").Editor, files: File[], pos: number) => void;
  /** Called when the user pastes files into the editor. */
  onPaste?: (editor: import("@tiptap/core").Editor, files: File[]) => void;
}

/**
 * Derive a stable vibrant hex color from a username string.
 * Uses HSL with fixed saturation/lightness for readability.
 */
export function userColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  // HSL → hex: saturation 70%, lightness 45% gives vivid but readable colors
  return hslToHex(hue, 70, 45);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Build a Google-Docs-style remote cursor element:
 * - 2px vertical caret line in user's color
 * - Small floating name label above the caret
 */
export function buildCursorElement(user: Record<string, string>): HTMLElement {
  const color = user.color ?? "#888";
  const name = user.name ?? "Unknown";

  const caret = document.createElement("span");
  caret.style.cssText = [
    `border-left: 2px solid ${color}`,
    "border-right: none",
    "border-top: none",
    "border-bottom: none",
    "margin-left: -1px",
    "margin-right: -1px",
    "position: relative",
    "word-break: normal",
    "pointer-events: none",
  ].join(";");

  const label = document.createElement("span");
  label.textContent = name;
  label.style.cssText = [
    `background-color: ${color}`,
    "color: #fff",
    "font-size: 10px",
    "font-family: ui-sans-serif, system-ui, sans-serif",
    "line-height: 1.2",
    "padding: 1px 4px",
    "border-radius: 3px",
    "position: absolute",
    "top: -1.4em",
    "left: -1px",
    "white-space: nowrap",
    "pointer-events: none",
    "user-select: none",
    "z-index: 10",
  ].join(";");

  caret.appendChild(label);
  return caret;
}

/**
 * Math delimiters, Obsidian-style. `$$…$$` first so display math is consumed
 * whole — a second alternative would otherwise match the inner `$…$` and paint
 * the equation twice. Inline `$…$` requires a non-space after the opening `$`
 * and before the closing one, and no digit after it, so prose prices
 * ("$5 and $10 today") stay prose.
 *
 * Mathematics reads the first truthy capture group, so both alternatives can
 * live in one regex.
 *
 * ponytail: `$$…$$` renders in inline mode — katexOptions is per-extension,
 * not per-match. Split into a second Mathematics instance (distinct `name`,
 * inline regex tightened to exclude `$$`) if centred display math matters.
 *
 * Known edge: math the caret sits inside stays raw (that is the editing
 * affordance), which includes math at position 1 of a fresh document, since
 * the default selection lands there. It renders as soon as the caret moves.
 */
const MATH_REGEX = /\$\$([^$]+?)\$\$|\$(?![\s$])([^$\n]*[^\s$])\$(?!\d)/g;

const MathRendering = Mathematics.extend({
  // Decorations are built only in the plugin's `apply`, so a document seeded at
  // construction (non-collab notes pass `content: initialMd`) never triggers
  // one and math stays raw until the first keystroke. An empty transaction
  // forces the first pass; it has no docChanged, so it fires no autosave.
  onCreate() {
    this.editor.view.dispatch(this.editor.state.tr);
  },
}).configure({
  regex: MATH_REGEX,
  katexOptions: { throwOnError: false },
  // Default guard skips code blocks; inline `code` marks need the same
  // treatment or documenting `$x$` inside backticks renders as math.
  shouldRender: (state, pos, node) =>
    defaultShouldRender(state, pos) &&
    !node.marks.some((m) => m.type.name === "code"),
});

export type WikiLinkSuggestion = Omit<SuggestionOptions, "editor" | "pluginKey">;

export const SlashCommandPluginKey = new PluginKey("slashCommand");

export const SlashCommand = Extension.create({
  name: "slashCommand",
});

export type SlashCommandSuggestion = Omit<SuggestionOptions, "editor" | "pluginKey" | "allow">;

/**
 * Returns true when the cursor is inside a `code_block` node.
 * Used by the slash-command Suggestion `allow` predicate to suppress the menu
 * inside code fences.
 */
export function isInsideCodeBlock(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === "codeBlock") return true;
  }
  return false;
}

/**
 * Returns true when the character immediately before the cursor is `\`.
 * Used by the slash-command Suggestion `allow` predicate so that `\/cite`
 * is treated as literal text rather than a slash command trigger.
 */
export function isPrecededByBackslash(state: EditorState): boolean {
  const { $from } = state.selection;
  const textBefore = $from.nodeBefore?.text ?? "";
  return textBefore.endsWith("\\");
}

export interface CollabOptions {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  user: { name: string; color?: string };
}

export function editorExtensions(opts?: {
  placeholder?: string;
  wikiLinkSuggestion?: WikiLinkSuggestion;
  /**
   * Trigger string for the WikiLink Suggestion plugin. Defaults to `"[["` so
   * the existing NoteEditor call-site keeps working unchanged. Round B
   * (GSD-96 Tiptap @-picker) sets this to `"@"` to reuse the same suggestion
   * stack for ChatComposer mentions.
   */
  wikiLinkTriggerChar?: string;
  slashCommandSuggestion?: SlashCommandSuggestion;
  collab?: CollabOptions;
  fileUpload?: FileUploadOptions;
}) {
  const wikiLink = opts?.wikiLinkSuggestion
    ? WikiLink.extend({
        addProseMirrorPlugins() {
          // Preserve base WikiLink plugins (e.g. K6 self-heal) — Tiptap's
          // addProseMirrorPlugins is a full override unless we re-include
          // `this.parent?.()`. Dropping the self-heal plugin leaves legacy
          // YJS-hydrated wikiLink nodes with raw prefixes + null targetKind
          // permanently unhealed in the KM build.
          return [
            ...(this.parent?.() ?? []),
            Suggestion({
              ...opts.wikiLinkSuggestion,
              editor: this.editor,
              char: opts.wikiLinkTriggerChar ?? "[[",
            }),
          ];
        },
      })
    : WikiLink;

  const slashCommand = opts?.slashCommandSuggestion
    ? SlashCommand.extend({
        addProseMirrorPlugins() {
          return [
            Suggestion({
              ...opts.slashCommandSuggestion,
              editor: this.editor,
              pluginKey: SlashCommandPluginKey,
              char: "/",
              // Non-overrideable regression locks: suppress inside code blocks
              // and after backslash escape. Type omits `allow` from
              // SlashCommandSuggestion so callers cannot bypass these.
              allow: ({ state }) =>
                !isInsideCodeBlock(state) && !isPrecededByBackslash(state),
            }),
          ];
        },
      })
    : null;

  const collab = opts?.collab;

  return [
    ...baseExtensions({
      collaborative: !!collab,
      // Attach the React NodeView (language switcher) to CodeBlockLowlight.
      // The markdown package itself is React-free; we pass the renderer in
      // from here so headless callers (md round-trip tests) keep working.
      codeBlockExtend: (ext) =>
        ext.extend({
          addNodeView() {
            return ReactNodeViewRenderer(CodeBlockNodeView);
          },
        }),
    }),
    wikiLink,
    TagMark,
    BibliographyHeading,
    MathRendering,
    Placeholder.configure({ placeholder: opts?.placeholder ?? "Start writing…" }),
    ...(slashCommand ? [slashCommand] : []),
    ...(collab
      ? [
          Collaboration.configure({ document: collab.ydoc, field: Y_PROSEMIRROR_FIELD }),
          CollaborationCursor.configure({
            provider: collab.provider,
            user: collab.user,
            // Google-Docs-style remote cursor: thin caret + floating name label.
            // Own-user cursor is already excluded by y-prosemirror's
            // defaultAwarenessStateFilter (currentClientId !== userClientId).
            render: buildCursorElement,
            // Semi-transparent selection highlight (alpha ~20%) instead of
            // the default opaque block.
            selectionRender: (user: Record<string, string>) => ({
              style: `background-color: ${user.color ?? "#888"}33`,
              class: "collaboration-cursor__selection",
            }),
          }),
        ]
      : []),
    MdPaste,
    TaskListShortcut,
    CollapsibleHeading,
    GlobalDragHandle.configure({
      // Default settings; consumers can override via styles.css `.drag-handle`.
      dragHandleWidth: 20,
    }),
    ...(opts?.fileUpload
      ? [
          FileHandler.configure({
            allowedMimeTypes:
              opts.fileUpload.allowedMimeTypes ?? [
                "image/png",
                "image/jpeg",
                "image/gif",
                "image/webp",
              ],
            onDrop: (editor, files, pos) => {
              opts.fileUpload?.onDrop?.(editor, files, pos);
            },
            onPaste: (editor, files) => {
              opts.fileUpload?.onPaste?.(editor, files);
            },
          }),
        ]
      : []),
  ];
}