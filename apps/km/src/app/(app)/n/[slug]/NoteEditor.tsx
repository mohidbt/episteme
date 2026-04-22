"use client";
import {
  Editor,
  type ResolvedLinksMap,
  type TiptapEditor,
  type WikiLinkSuggestion,
} from "@episteme/editor";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WikiLinkTypeahead, type WikiLinkTypeaheadRef } from "@/components/WikiLinkTypeahead";
import { runSlashAi, SLASH_AI_REGEX } from "./run-slash-ai";

export function NoteEditor({
  id,
  initialMd,
  resolvedLinks,
  flushRef,
}: {
  id: string;
  initialMd: string;
  resolvedLinks?: ResolvedLinksMap;
  flushRef?: RefObject<(() => Promise<void>) | null>;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMdRef = useRef<string | null>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TiptapEditor | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);

  const onReady = useCallback((editor: TiptapEditor) => {
    editorRef.current = editor;
  }, []);

  const flush = useCallback((): Promise<void> => {
    const md = pendingMdRef.current;
    if (md == null) return Promise.resolve();
    pendingMdRef.current = null;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return fetch(`/api/notes/${id}/content`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentMd: md }),
      keepalive: true,
    })
      .then(() => undefined)
      .catch((err) => {
        console.warn("[autosave] failed", err);
      });
  }, [id]);

  const onChangeMd = useCallback(
    (md: string) => {
      pendingMdRef.current = md;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 800);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = flush;
    return () => {
      if (flushRef.current === flush) flushRef.current = null;
    };
  }, [flush, flushRef]);

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) return;

    // Click/dblclick coordination: dblclick fires after two click events, so
    // naive navigation on single click steals the second click and the pill
    // never gets edited. We defer navigation by the browser's dblclick
    // threshold (~250ms) and cancel it if a dblclick arrives in time.
    let pendingNav: ReturnType<typeof setTimeout> | null = null;
    let pendingNavKey = 0;
    const cancelPendingNav = () => {
      if (pendingNav) {
        clearTimeout(pendingNav);
        pendingNav = null;
      }
    };

    const routeWikiLink = (wikiEl: HTMLElement) => {
      const kind = wikiEl.getAttribute("data-target-kind") as
        | "note"
        | "reference"
        | "paper"
        | null;
      const id = wikiEl.getAttribute("data-target-id");
      const title = wikiEl.getAttribute("data-title") ?? "";
      flush();
      if (kind === "reference" && id) {
        router.push(`/r/${id}`);
        return;
      }
      if (kind === "paper" && id) {
        router.push(`/p/${id}`);
        return;
      }
      // Notes: we need the slug, which the pill doesn't carry. Fall back to
      // the server-hydrated resolvedLinks map (keyed by lowercased title).
      const hit = resolvedLinks?.[title.toLowerCase()];
      if (hit?.targetKind === "note" && hit.targetSlug) {
        router.push(`/n/${encodeURIComponent(hit.targetSlug)}`);
      }
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const tagEl = target?.closest?.('[data-type="tag"]') as HTMLElement | null;
      if (tagEl) {
        const tag = tagEl.getAttribute("data-tag");
        if (!tag) return;
        e.preventDefault();
        flush();
        router.push(`/tags/${encodeURIComponent(tag)}`);
        return;
      }
      const wikiEl = target?.closest?.(
        '[data-type="wiki-link"]',
      ) as HTMLElement | null;
      if (!wikiEl) return;
      e.preventDefault();
      cancelPendingNav();
      const key = ++pendingNavKey;
      pendingNav = setTimeout(() => {
        pendingNav = null;
        if (key !== pendingNavKey) return;
        routeWikiLink(wikiEl);
      }, 250);
    };

    const onDblClick = (e: MouseEvent) => {
      const editor = editorRef.current;
      if (!editor) return;
      const target = e.target as HTMLElement | null;
      const wikiEl = target?.closest?.(
        '[data-type="wiki-link"]',
      ) as HTMLElement | null;
      if (!wikiEl) return;
      // Cancel the pending single-click navigation the two clicks scheduled.
      cancelPendingNav();
      pendingNavKey++;
      e.preventDefault();
      const pos = editor.view.posAtDOM(wikiEl, 0);
      if (pos < 0) return;
      const node = editor.state.doc.nodeAt(pos);
      if (!node || node.type.name !== "wikiLink") return;
      // Replace the pill with `[[<title-without-prefix>` and drop the cursor
      // at the end. The Suggestion plugin (trigger char `[[`) re-opens the
      // typeahead with the stripped title as the query so the user can pick
      // a different target — or re-confirm the same one.
      const rawTitle = (node.attrs.title as string) ?? "";
      const stripped = rawTitle.startsWith("@")
        ? rawTitle.slice(1)
        : rawTitle.startsWith("pdf:")
          ? rawTitle.slice(4)
          : rawTitle;
      const insertText = `[[${stripped}`;
      const caretOffset = insertText.length;
      // Use a raw schema text node (not `insertContentAt`) so tiptap-markdown
      // does NOT re-parse `[[...]]` into a new unresolved wikiLink atom.
      editor
        .chain()
        .focus()
        .command(({ tr, state }) => {
          tr.replaceWith(
            pos,
            pos + node.nodeSize,
            state.schema.text(insertText),
          );
          return true;
        })
        .setTextSelection(pos + caretOffset)
        .run();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const editor = editorRef.current;
      if (!editor) return;
      const { state } = editor;
      const { $from } = state.selection;
      // Current paragraph node (depth 1 on a flat doc).
      const para = $from.parent;
      if (para.type.name !== "paragraph") return;
      const paraText = para.textContent;
      const match = paraText.match(SLASH_AI_REGEX);
      if (!match) return;
      const prompt = match[1];

      e.preventDefault();

      // Compute paragraph start/end positions.
      const paraStart = $from.start($from.depth);
      const paraEnd = $from.end($from.depth);

      // Derive context from the previous paragraph, if any.
      let context: string | undefined;
      const beforeResolved = state.doc.resolve(Math.max(0, paraStart - 1));
      const before = beforeResolved.nodeBefore;
      if (before && before.type.name === "paragraph") {
        const prevText = before.textContent.trim();
        if (prevText) context = prevText;
      }

      // Clear the `/ai <prompt>` line and place the cursor at its start.
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.delete(paraStart, paraEnd);
          return true;
        })
        .run();

      // Abort any in-flight call before starting a new one.
      aiAbortRef.current?.abort();
      const controller = new AbortController();
      aiAbortRef.current = controller;

      void runSlashAi({
        prompt,
        context,
        signal: controller.signal,
        onToken: (chunk) => {
          editor.chain().focus().insertContent(chunk).run();
        },
        onError: (message) => {
          editor.chain().focus().insertContent(`[ai error: ${message}]`).run();
        },
      }).finally(() => {
        // Clear only if still the current controller.
        if (aiAbortRef.current === controller) aiAbortRef.current = null;
      });
    };

    host.addEventListener("click", onClick);
    host.addEventListener("dblclick", onDblClick);
    host.addEventListener("keydown", onKeyDown);
    return () => {
      host.removeEventListener("click", onClick);
      host.removeEventListener("dblclick", onDblClick);
      host.removeEventListener("keydown", onKeyDown);
      cancelPendingNav();
      aiAbortRef.current?.abort();
      aiAbortRef.current = null;
    };
  }, [router, flush, resolvedLinks]);

  const wikiLinkSuggestion = useMemo<WikiLinkSuggestion>(
    () => ({
      command: ({ editor, range, props }) => {
        const p = props as {
          title: string;
          targetKind: "note" | "reference" | "paper";
          targetId: string | null;
        };
        // Match the markdown prefixes used by extractLinks():
        //   [[@key]]     → reference
        //   [[pdf:name]] → paper
        const titleWithPrefix =
          p.targetKind === "reference"
            ? `@${p.title}`
            : p.targetKind === "paper"
              ? `pdf:${p.title}`
              : p.title;
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent([
            {
              type: "wikiLink",
              attrs: {
                title: titleWithPrefix,
                alias: null,
                targetKind: p.targetKind,
                targetId: p.targetId,
              },
            },
            { type: "text", text: " " },
          ])
          .run();
      },
      render: () => {
        let root: Root | null = null;
        let host: HTMLDivElement | null = null;
        let refObj: { current: WikiLinkTypeaheadRef | null } = { current: null };

        const place = (clientRect: (() => DOMRect | null) | null | undefined) => {
          if (!host) return;
          const rect = clientRect?.() ?? null;
          if (!rect) {
            host.style.display = "none";
            return;
          }
          host.style.display = "block";
          host.style.top = `${rect.bottom + window.scrollY + 4}px`;
          host.style.left = `${rect.left + window.scrollX}px`;
        };

        return {
          onStart: (props) => {
            host = document.createElement("div");
            host.style.position = "absolute";
            host.style.zIndex = "50";
            document.body.appendChild(host);
            root = createRoot(host);
            refObj = { current: null };
            root.render(
              <WikiLinkTypeahead
                ref={(r) => {
                  refObj.current = r;
                }}
                query={props.query}
                onSelect={(payload) => props.command(payload as never)}
              />,
            );
            place(props.clientRect);
          },
          onUpdate: (props) => {
            if (!root) return;
            root.render(
              <WikiLinkTypeahead
                ref={(r) => {
                  refObj.current = r;
                }}
                query={props.query}
                onSelect={(payload) => props.command(payload as never)}
              />,
            );
            place(props.clientRect);
          },
          onKeyDown: (props) => {
            if (props.event.key === "Escape") {
              root?.unmount();
              host?.remove();
              root = null;
              host = null;
              return true;
            }
            return refObj.current?.onKeyDown({ event: props.event }) ?? false;
          },
          onExit: () => {
            root?.unmount();
            host?.remove();
            root = null;
            host = null;
          },
        };
      },
    }),
    [],
  );

  return (
    <div ref={editorHostRef}>
      <Editor
        initialMd={initialMd}
        onChangeMd={onChangeMd}
        autofocus
        wikiLinkSuggestion={wikiLinkSuggestion}
        resolvedLinks={resolvedLinks}
        onReady={onReady}
      />
    </div>
  );
}
