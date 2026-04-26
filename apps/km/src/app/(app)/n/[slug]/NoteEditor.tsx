"use client";
import {
  Editor,
  createCollabProvider,
  userColor,
  type CollabProvider,
  type ResolvedLinksMap,
  type WikiLinkSuggestion,
  type SlashCommandSuggestion,
  type TiptapEditor,
  type CitationMeta,
  insertCitation,
  insertPdfEmbed,
  insertWikiLink,
  invokeAgent,
  hydrateCitations,
} from "@episteme/editor";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { COLLAB_ENABLED, COLLAB_URL } from "@/lib/flags";
import { createRoot, type Root } from "react-dom/client";
import { WikiLinkTypeahead, type WikiLinkTypeaheadRef } from "@/components/WikiLinkTypeahead";
import { SlashCommandTypeahead, type SlashCommandTypeaheadRef } from "@/components/SlashCommandTypeahead";
import { AiBubbleMenu } from "@/components/AiBubbleMenu";
import { TableBubbleMenu } from "@/components/TableBubbleMenu";

export function NoteEditor({
  id,
  initialMd,
  resolvedLinks,
  flushRef,
  userName,
  initialCollabToken,
  editorRef: externalEditorRef,
}: {
  id: string;
  initialMd: string;
  resolvedLinks?: ResolvedLinksMap;
  flushRef?: RefObject<(() => Promise<void>) | null>;
  userName?: string;
  /** SSR-minted collab JWT. When provided, skips the client-side /api/collab/token fetch. */
  initialCollabToken?: string | null;
  editorRef?: RefObject<TiptapEditor | null>;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMdRef = useRef<string | null>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TiptapEditor | null>(null);
  const [editorInstance, setEditorInstance] = useState<TiptapEditor | null>(null);
  const [aiTriggerCount, setAiTriggerCount] = useState(0);

  // Collab token — SSR-minted by the server component and passed as a prop,
  // so the provider can be created synchronously on first render with no
  // client-side round-trip. Falls back to a client-side POST fetch when the
  // prop is absent (e.g. tests, or a future non-SSR entry point).
  const [collabToken, setCollabToken] = useState<string | null>(
    COLLAB_ENABLED ? (initialCollabToken ?? null) : null,
  );
  useEffect(() => {
    if (!COLLAB_ENABLED) return;
    // If we already have a token (from SSR prop), skip the fetch.
    if (initialCollabToken) return;
    let cancelled = false;
    fetch("/api/collab/token", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          console.error("[NoteEditor] /api/collab/token returned", res.status, "— collab disabled");
          return;
        }
        const { token } = (await res.json()) as { token: string };
        if (!cancelled) setCollabToken(token);
      })
      .catch((err) => {
        console.error("[NoteEditor] failed to fetch collab token", err);
      });
    return () => {
      cancelled = true;
    };
  }, [id, initialCollabToken]);

  const collabState = useMemo<CollabProvider | null>(() => {
    if (!COLLAB_ENABLED || !collabToken) return null;
    return createCollabProvider({ noteId: id, url: COLLAB_URL, token: collabToken });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, collabToken]);

  useEffect(() => {
    if (!collabState) return;
    return () => {
      collabState.destroy();
    };
  }, [collabState]);

  // Single-shot guard: flip to `true` after the first retry attempt so rapid
  // back-to-back `authenticationFailed` events don't spam the token endpoint.
  // Reset whenever `id` changes (new note mount).
  const authRetryFiredRef = useRef(false);
  useEffect(() => {
    authRetryFiredRef.current = false;
  }, [id]);

  // Defense-in-depth: if the provider rejects our token (e.g. the SSR-minted
  // JWT expired during slow hydration or bfcache restore), fetch a fresh token
  // and let the useMemo re-create the provider with it.
  useEffect(() => {
    if (!collabState) return;
    const onAuthFail = () => {
      if (authRetryFiredRef.current) return;
      authRetryFiredRef.current = true;
      fetch("/api/collab/token", { method: "POST" })
        .then(async (res) => {
          if (!res.ok) {
            console.error(
              "[NoteEditor] auth-failure retry: /api/collab/token returned",
              res.status,
            );
            return;
          }
          const { token } = (await res.json()) as { token: string };
          setCollabToken(token);
        })
        .catch((err) => {
          console.error("[NoteEditor] auth-failure retry fetch error", err);
        });
    };
    collabState.provider.on("authenticationFailed", onAuthFail);
    return () => {
      collabState.provider.off("authenticationFailed", onAuthFail);
    };
  }, [collabState]);

  const onReady = useCallback((editor: TiptapEditor) => {
    editorRef.current = editor;
    if (externalEditorRef) externalEditorRef.current = editor;
    setEditorInstance(editor);

    // Hydrate citations fire-and-forget: refill bibIndex + metadata + bibliography
    // from fresh server data so reload restores [n] indices and hover tooltips.
    // This must not block first paint.
    void hydrateCitations(editor, async (citekeys: string[]): Promise<CitationMeta[]> => {
      try {
        const r = await fetch("/api/citations/by-citekeys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ citekeys }),
        });
        if (!r.ok) return [];
        const data = await r.json() as { results: CitationMeta[] };
        return data.results;
      } catch {
        return [];
      }
    });
  }, []);

  const flush = useCallback((): Promise<void> => {
    // When Hocuspocus is active it owns persistence — skip the PATCH path.
    if (collabState) return Promise.resolve();
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
  }, [id, collabState]);

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

    host.addEventListener("click", onClick);
    host.addEventListener("dblclick", onDblClick);
    return () => {
      host.removeEventListener("click", onClick);
      host.removeEventListener("dblclick", onDblClick);
      cancelPendingNav();
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
            try { root?.unmount(); } catch (_) { /* portal already removed by DOM mutation */ }
            try { host?.remove(); } catch (_) { /* already detached */ }
            root = null;
            host = null;
          },
        };
      },
    }),
    [],
  );

  const slashCommandSuggestion = useMemo<SlashCommandSuggestion>(
    () => ({
      command: ({ editor, range, props }) => {
        // Delete the `/` trigger and any typed query characters
        editor.chain().focus().deleteRange(range).run();

        const p = props as {
          title: string;
          citation?: { citekey: string; title: string; authors: string[]; year: string | null };
          pdfEmbed?: { pdfId: string; title: string; page: number | null };
          wikiLink?: { title: string; targetKind: "note" | "reference" | "paper"; targetId: string | null };
          agent?: { skill: string };
        };
        if (p.title === "AI") {
          // Trigger the AI Rephrase portal — increment counter to force re-render
          setAiTriggerCount((c) => c + 1);
        } else if (p.title === "Cite" && p.citation) {
          insertCitation(editor, p.citation);
        } else if (p.title === "PDF" && p.pdfEmbed) {
          insertPdfEmbed(editor, p.pdfEmbed);
        } else if (p.title === "Link" && p.wikiLink) {
          insertWikiLink(editor, p.wikiLink);
        } else if (p.title === "Agent" && p.agent) {
          invokeAgent(editor, p.agent);
        } else if (p.title === "Table") {
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run();
        } else if (p.title === "Code Block") {
          editor
            .chain()
            .focus()
            .toggleCodeBlock({ language: "ts" })
            .run();
        }
      },
      render: () => {
        let root: Root | null = null;
        let host: HTMLDivElement | null = null;
        let refObj: { current: SlashCommandTypeaheadRef | null } = { current: null };

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

        const onStart = (props: any) => {
          host = document.createElement("div");
          host.style.position = "absolute";
          host.style.zIndex = "50";
          document.body.appendChild(host);
          root = createRoot(host);
          refObj = { current: null };
          root.render(
            <SlashCommandTypeahead
              ref={(r) => {
                refObj.current = r;
              }}
              query={props.query}
              onSelect={(payload) => props.command(payload as never)}
            />,
          );
          place(props.clientRect);
        };

        const onUpdate = (props: any) => {
          if (!root) return;
          root.render(
            <SlashCommandTypeahead
              ref={(r) => {
                refObj.current = r;
              }}
              query={props.query}
              onSelect={(payload) => props.command(payload as never)}
            />,
          );
          place(props.clientRect);
        };

        const onKeyDown = (props: any) => {
          if (props.event.key === "Escape") {
            root?.unmount();
            host?.remove();
            root = null;
            host = null;
            return true;
          }
          return refObj.current?.onKeyDown({ event: props.event }) ?? false;
        };

        const onExit = () => {
          try { root?.unmount(); } catch (_) { /* portal already removed by DOM mutation */ }
          try { host?.remove(); } catch (_) { /* already detached */ }
          root = null;
          host = null;
        };

        return { onStart, onUpdate, onKeyDown, onExit };
      },
    }),
    [],
  );

  const name = userName ?? "anonymous";
  const collabProp = collabState
    ? {
        ydoc: collabState.ydoc,
        provider: collabState.provider,
        user: { name, color: userColor(name) },
      }
    : undefined;

  // When COLLAB_ENABLED, defer rendering Editor until the provider exists.
  // Mounting Editor first with collab=undefined and then setting collab on
  // a later render destroys+recreates the Tiptap editor mid-React-commit
  // and causes "insertBefore on Node" DOM crashes. Single Editor lifecycle.
  const editorReady = !COLLAB_ENABLED || collabState !== null;

  return (
    <div ref={editorHostRef}>
      {editorReady ? (
        <Editor
          initialMd={initialMd}
          onChangeMd={onChangeMd}
          autofocus
          wikiLinkSuggestion={wikiLinkSuggestion}
          slashCommandSuggestion={slashCommandSuggestion}
          resolvedLinks={resolvedLinks}
          onReady={onReady}
          collab={collabProp}
        >
          {editorInstance && (
            <>
              <AiBubbleMenu editor={editorInstance} aiTriggerCount={aiTriggerCount} />
              <TableBubbleMenu editor={editorInstance} />
            </>
          )}
        </Editor>
      ) : (
        <div className="min-h-[60vh] opacity-50" aria-busy="true" />
      )}
    </div>
  );
}