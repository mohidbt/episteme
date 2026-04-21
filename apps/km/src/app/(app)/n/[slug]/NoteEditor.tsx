"use client";
import { Editor, type WikiLinkSuggestion } from "@episteme/editor";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WikiLinkTypeahead, type WikiLinkTypeaheadRef } from "@/components/WikiLinkTypeahead";

export function NoteEditor({ id, initialMd }: { id: string; initialMd: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMdRef = useRef<string | null>(null);

  const flush = useCallback(() => {
    const md = pendingMdRef.current;
    if (md == null) return;
    pendingMdRef.current = null;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    fetch(`/api/notes/${id}/content`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentMd: md }),
      keepalive: true,
    }).catch((err) => {
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

  const wikiLinkSuggestion = useMemo<WikiLinkSuggestion>(
    () => ({
      command: ({ editor, range, props }) => {
        // Replace the `[[query` range with a wikiLink node + trailing space.
        const p = props as {
          title: string;
          targetKind: "note";
          targetId: string | null;
        };
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent([
            {
              type: "wikiLink",
              attrs: {
                title: p.title,
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
            if (props.event.key === "Escape") return true;
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
    <Editor
      initialMd={initialMd}
      onChangeMd={onChangeMd}
      autofocus
      wikiLinkSuggestion={wikiLinkSuggestion}
    />
  );
}
