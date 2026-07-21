"use client";

import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { toast } from "sonner";

import { ReaderToolbar } from "./ReaderToolbar";
import { SelectionToolbar, type HighlightColor } from "./SelectionToolbar";
import { HighlightsSidebar } from "./HighlightsSidebar";
import { CommentsSidebar } from "./CommentsSidebar";
import { OutlineSidebar, type PdfOutlineItem } from "./OutlineSidebar";
import { CitationsSidebar } from "./CitationsSidebar";
import { CitationCard, type CitationWithStatus, type FolderOption } from "./CitationCard";
import { DockMenu, useSidebarDock, type Dock } from "./DockableSidebar";
import { PdfViewer } from "./PdfViewer";

import { usePdfDocument } from "../hooks/use-pdf-document";
import { useTextSelection } from "../hooks/use-text-selection";
import { useReaderState } from "../hooks/use-reader-state";
import { useCitationClick } from "../hooks/use-citation-click";
import { useCitationEnrichment } from "../hooks/use-citation-enrichment";
import { useUserHighlights } from "../hooks/use-user-highlights";
import { usePaperHighlights } from "../hooks/use-paper-highlights";
import { postHighlightsChange } from "../lib/highlights-channel";
import { deriveChatAgentRuns } from "../lib/derive-chat-agent-runs";
import { filterVisibleHighlights } from "../lib/filter-visible-highlights";
import { scrollContainerToSegmentWithRetry, type SegmentBbox } from "../lib/scroll-to-segment";
import type { ReaderMode } from "../plugins/types";

type DocProcessingStatus = "pending" | "processing" | "ready" | "failed";

interface PaperMeta {
  title: string;
  processingStatus: DocProcessingStatus;
}

export type ReaderProps = {
  paperId: string;
  mode?: ReaderMode;
  className?: string;
  /**
   * Optional callback invoked when the user clicks "Explain" on a text
   * selection. The consumer (apps/km) wires this to the KM agent side panel.
   */
  onExplainPassage?: (args: { page: number; text: string }) => void;
  /**
   * Optional agent side-panel slot. When provided, Reader renders an "Agent"
   * toolbar toggle that mounts this node in the same dockable scaffold as
   * Highlights / Comments / Outline / Citations.
   */
  agentSlot?: ReactNode;
  agentOpen?: boolean;
  onAgentOpenChange?: (open: boolean) => void;
  /**
   * BG2a follow-up — initial 1-indexed page to scroll to on mount (e.g. from
   * `?p=<n>` deeplinks). Consumed once; clamped to `[1, totalPages]` when
   * totalPages is known. Out-of-range values are ignored (stay on page 1).
   * Prop-based to avoid the dispatch/listen race between consumer effect and
   * Reader's `episteme:reader-jump` mount listener.
   */
  initialPage?: number;
};

interface MarkerRect {
  id: number;
  referenceId: number;
  markerIndex: number;
  pageNumber: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface AutoHighlightRun {
  id: string;
  instruction: string;
  summary: string | null;
  highlightCount: number;
}

/**
 * Renders a Separator + Panel pair as a fragment so callers can place
 * sidebar panels alongside the PDF panel inside a single Group. Separator
 * sits on the side facing the PDF (right of left dock, left of right dock,
 * top of bottom dock).
 */
function SidebarPanelFragment({
  panelId,
  children,
  side,
  isFirst,
  withBorderLeft,
  withBorderRight,
}: {
  panelId: string;
  children: React.ReactNode;
  side: "left" | "right" | "bottom";
  isFirst: boolean;
  withBorderLeft?: boolean;
  withBorderRight?: boolean;
}) {
  const minSize = side === "bottom" ? "120px" : "280px";
  const defaultSize = side === "bottom" ? "30%" : "25%";
  const sepClass = "w-1 cursor-col-resize bg-border data-[hover]:bg-primary/40";
  const panel = (
    <Panel
      id={panelId}
      minSize={minSize}
      defaultSize={defaultSize}
      className={[
        "flex h-full overflow-hidden bg-background",
        withBorderLeft ? "border-l" : "",
        withBorderRight ? "border-r" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={`panel-${panelId}`}
    >
      {children}
    </Panel>
  );
  if (side === "left") {
    return (
      <>
        {panel}
        <Separator id={`sep-${panelId}`} className={sepClass} />
      </>
    );
  }
  if (side === "right") {
    return (
      <>
        <Separator id={`sep-${panelId}`} className={sepClass} />
        {panel}
      </>
    );
  }
  if (isFirst) return panel;
  return (
    <>
      <Separator id={`sep-${panelId}`} className={sepClass} />
      {panel}
    </>
  );
}

export function Reader({
  paperId,
  mode = "full",
  className,
  onExplainPassage,
  agentSlot,
  agentOpen: agentOpenProp,
  onAgentOpenChange,
  initialPage,
}: ReaderProps) {
  // Paper meta (title, processingStatus)
  const [meta, setMeta] = useState<PaperMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/papers/${paperId}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { paper?: { title?: string; processingStatus?: DocProcessingStatus } } | { title?: string; processingStatus?: DocProcessingStatus }) => {
        // Accept either { paper: {...} } or {...} shape.
        const paper =
          (data as { paper?: PaperMeta }).paper ??
          (data as PaperMeta);
        setMeta({
          title: paper.title ?? "",
          processingStatus: (paper.processingStatus as DocProcessingStatus) ?? "ready",
        });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setMetaError("Failed to load paper");
        setMeta({ title: "", processingStatus: "ready" });
      });
    return () => controller.abort();
  }, [paperId]);

  const { url } = usePdfDocument(paperId);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openHighlightsToAiNonce, setOpenHighlightsToAiNonce] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [citationsOpen, setCitationsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [agentOpenState, setAgentOpenState] = useState(false);
  const agentOpen = agentOpenProp ?? agentOpenState;
  const setAgentOpen = useCallback(
    (open: boolean) => {
      if (agentOpenProp === undefined) setAgentOpenState(open);
      onAgentOpenChange?.(open);
    },
    [agentOpenProp, onAgentOpenChange],
  );
  const pdfScrollRef = useRef<HTMLDivElement>(null);
  // Token for cancelling stale rAF poll loops on rapid scroll-to-highlight
  // clicks. Incremented per scheduled scroll; the polling closure aborts when
  // the ref no longer matches its captured token (codex R-B review).
  const scrollTokenRef = useRef(0);
  const { selection, clearSelection } = useTextSelection();

  type ActiveSelection = NonNullable<typeof selection>;
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);
  const [editingHighlight, setEditingHighlight] = useState<{
    id: number | string;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);

  const [pdfOutline, setPdfOutline] = useState<PdfOutlineItem[] | null>(null);
  const [pdfDoc, setPdfDoc] = useState<unknown>(null);

  // Per-sidebar dock position. Persisted via localStorage.
  const [highlightsDock, setHighlightsDock] = useSidebarDock("highlights", "right");
  const [outlineDock, setOutlineDock] = useSidebarDock("outline", "left");
  const [citationsDock, setCitationsDock] = useSidebarDock("citations", "right");
  const [commentsDock, setCommentsDock] = useSidebarDock("comments", "right");
  const [agentDock, setAgentDock] = useSidebarDock("agent", "right");

  // Citations
  const [citations, setCitations] = useState<CitationWithStatus[]>([]);
  const [citationsLoading, setCitationsLoading] = useState(true);
  const [citationsEnriching, setCitationsEnriching] = useState(false);
  const pendingCitationIds = useRef<Set<number>>(new Set());
  const { activeCitation, clickPosition, dismiss: dismissCitation } = useCitationClick(
    pdfScrollRef,
    citations
  );

  const [markers, setMarkers] = useState<MarkerRect[]>([]);
  const [citationsRefreshKey, setCitationsRefreshKey] = useState(0);
  const [folderOptions, setFolderOptions] = useState<FolderOption[]>([]);
  const [autoRuns, setAutoRuns] = useState<AutoHighlightRun[]>([]);
  const [pendingScrollHighlightId, setPendingScrollHighlightId] = useState<number | string | null>(null);
  const [pendingScrollRectIndex, setPendingScrollRectIndex] = useState<number>(0);

  // Folder list for the citation-card "Save to Library" picker. KM exposes
  // /api/folders; non-fatal on failure.
  //
  // Filter rules (applied client-side because other /api/folders consumers
  // may legitimately want the system folders):
  //   - Trash and any descendants of Trash are hidden.
  //   - The `.episteme` system folder and all of its descendants are hidden
  //     (agents/, skills/, memories/, deep-read/, lit-triage/, …).
  //   - Any folder whose name starts with `.` is hidden as a system folder.
  // The remaining folders are rendered as breadcrumb paths
  // ("Reading List / Foundations") so nested duplicates can be told apart.
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/folders`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: {
        folders?: {
          id: string;
          name: string;
          parentId: string | null;
          isTrash: boolean;
        }[];
      }) => {
        if (!Array.isArray(data?.folders)) return;
        const byId = new Map(data.folders.map((f) => [f.id, f]));
        const hiddenRoots = new Set<string>();
        for (const f of data.folders) {
          if (f.isTrash || f.name.startsWith(".")) hiddenRoots.add(f.id);
        }
        const isHidden = (id: string | null): boolean => {
          let cur = id;
          while (cur) {
            if (hiddenRoots.has(cur)) return true;
            const parent = byId.get(cur)?.parentId ?? null;
            cur = parent;
          }
          return false;
        };
        const pathOf = (f: { id: string; name: string; parentId: string | null }): string => {
          const parts: string[] = [];
          let cur: string | null = f.id;
          while (cur) {
            const node = byId.get(cur);
            if (!node) break;
            parts.unshift(node.name);
            cur = node.parentId;
          }
          return parts.join(" / ");
        };
        const visible = data.folders
          .filter((f) => !isHidden(f.id))
          .map((f) => ({ id: f.id, name: f.name, path: pathOf(f) }))
          .sort((a, b) => a.path.localeCompare(b.path));
        setFolderOptions(visible);
      })
      .catch(() => {/* non-fatal — picker just won't render */});
    return () => ctl.abort();
  }, []);

  const {
    highlights: sidebarHighlights,
    userHighlights,
    loading: highlightsLoading,
    error: highlightsError,
  } = useUserHighlights(paperId, refreshKey);
  const {
    highlights: paperHighlights,
    userHighlights: aiHighlights,
    loading: aiHighlightsLoading,
    error: aiHighlightsError,
  } = usePaperHighlights(paperId, refreshKey);
  const combinedUserHighlights = useMemo(
    () => [...userHighlights, ...aiHighlights],
    [userHighlights, aiHighlights],
  );
  // GSD-227 — client-side highlight visibility view-state (no DB mutation).
  //   hiddenRunLayerIds: layerIds (== run ids) of AI runs hidden from the PDF.
  //   hideAllUserHighlights: single toggle that hides every source==='user' rect.
  const [hiddenRunLayerIds, setHiddenRunLayerIds] = useState<Set<string>>(() => new Set());
  const [hideAllUserHighlights, setHideAllUserHighlights] = useState(false);
  const toggleRunVisibility = useCallback((runId: string) => {
    setHiddenRunLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }, []);
  const toggleAllUserHighlights = useCallback(() => {
    setHideAllUserHighlights((v) => !v);
  }, []);
  const visibleHighlights = useMemo(
    () =>
      filterVisibleHighlights(combinedUserHighlights, {
        hiddenLayerIds: hiddenRunLayerIds,
        hideAllUser: hideAllUserHighlights,
      }),
    [combinedUserHighlights, hiddenRunLayerIds, hideAllUserHighlights],
  );
  const aiSidebarHighlights = useMemo(
    () =>
      paperHighlights.map((h) => ({
        id: h.id,
        pageNumber: h.page,
        textContent: h.noteMd ?? "AI highlight",
        color: "amber",
        note: h.noteMd,
        comment: null,
        createdAt: h.createdAt,
        source: "ai-auto" as const,
        runId: h.runId ?? null,
        toolCallId: h.toolCallId ?? null,
        rects: aiHighlights.find((x) => x.id === h.id)?.rects ?? null,
      })),
    [paperHighlights, aiHighlights],
  );
  const mergedSidebarHighlights = useMemo(
    () => [
      ...aiSidebarHighlights,
      ...sidebarHighlights.map((h) => ({ ...h, source: h.source ?? ("user" as const) })),
    ],
    [aiSidebarHighlights, sidebarHighlights],
  );

  // When new AI highlights arrive (chat-agent tool wrote rows + channel/poll
  // refetch increased the count), surface them: open the highlights sidebar
  // and switch its segment to "AI". Initial mount load is ignored — we only
  // react to upward transitions after first paint.
  //
  // Keyed by paperId so navigating between papers re-baselines the count
  // instead of treating the new paper's pre-existing AI highlights as
  // "newly arrived" and force-opening the sidebar (codex review #2).
  const prevAiCountRef = useRef<{ paperId: string; count: number } | null>(null);
  useEffect(() => {
    const count = aiSidebarHighlights.length;
    const prev = prevAiCountRef.current;
    prevAiCountRef.current = { paperId, count };
    if (!prev || prev.paperId !== paperId) return;
    if (count > prev.count) {
      setSidebarOpen(true);
      setOpenHighlightsToAiNonce((n) => n + 1);
    }
  }, [aiSidebarHighlights.length, paperId]);
  // Derive runs from chat-agent highlights (paper_highlights.runId) so each
  // tool invocation that produced highlights shows up as a sidebar entry,
  // even when no ai_highlight_runs row exists (chat-agent highlight tool path).
  const chatAgentRuns = useMemo(
    () => deriveChatAgentRuns(paperHighlights, autoRuns.map((r) => r.id)),
    [paperHighlights, autoRuns],
  );
  const allRuns = [...autoRuns, ...chatAgentRuns];
  const highlightsSidebarError = mergedSidebarHighlights.length === 0 ? (highlightsError ?? aiHighlightsError) : null;
  const commentsSidebarError = sidebarHighlights.length === 0 ? highlightsError : null;

  useEffect(() => {
    setCitationsLoading(true);
    fetch(`/api/papers/${paperId}/citations`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { citations: CitationWithStatus[] }) => setCitations(data.citations))
      .catch(() => {/* non-fatal */})
      .finally(() => setCitationsLoading(false));
  }, [paperId, citationsRefreshKey]);

  // GSD-74 round 4: orchestrate the per-paper enrichment POST + the backoff
  // poll until every DOI-bearing ref has `enrichedAt` set. Parent-owned so
  // sidebar close+reopen doesn't re-POST, and so polling survives the
  // sidebar being unmounted while still working its way through the refs.
  useCitationEnrichment({
    paperId,
    citations,
    onRefetch: useCallback(() => setCitationsRefreshKey((k) => k + 1), []),
    onEnrichingChange: setCitationsEnriching,
  });

  useEffect(() => {
    fetch(`/api/papers/${paperId}/citations/markers`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { markers: MarkerRect[] }) => setMarkers(data.markers))
      .catch(() => {/* non-fatal */});
  }, [paperId, citationsRefreshKey]);

  useEffect(() => {
    fetch(`/api/papers/${paperId}/auto-highlight/runs`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { runs?: AutoHighlightRun[] }) => setAutoRuns(data.runs ?? []))
      .catch(() => setAutoRuns([]));
  }, [paperId, refreshKey]);

  const patchCitation = useCallback(
    (citationId: number, patch: Partial<CitationWithStatus>) => {
      setCitations((prev) => prev.map((c) => (c.id === citationId ? { ...c, ...patch } : c)));
    },
    []
  );

  const handleSaveToLibrary = useCallback(
    async (citationId: number, folderId: string | null) => {
      if (pendingCitationIds.current.has(citationId)) return;
      pendingCitationIds.current.add(citationId);
      try {
        const res = await fetch(`/api/papers/${paperId}/citations/${citationId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(folderId ? { folderId } : {}),
        });
        if (res.ok) {
          const { keptId, libraryReferenceId } = (await res.json()) as {
            keptId: number;
            libraryReferenceId: number;
          };
          patchCitation(citationId, { keptId, libraryReferenceId });
          toast.success("Saved to library");
        } else {
          toast.error("Failed to save to library");
        }
      } finally {
        pendingCitationIds.current.delete(citationId);
      }
    },
    [paperId, patchCitation]
  );

  const toolbarSelection = activeSelection ?? selection;

  const saveHighlight = useCallback(
    async (color: HighlightColor | "yellow"): Promise<number | null> => {
      const sel = activeSelection ?? selection;
      if (!sel) return null;
      setSaveError(null);
      try {
        const res = await fetch(`/api/user-highlights`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paperId,
            pageNumber: sel.pageNumber,
            textContent: sel.text,
            startOffset: sel.startOffset,
            endOffset: sel.endOffset,
            color,
            rects: sel.rects,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { highlight: { id: number } };
        return data.highlight.id;
      } catch {
        setSaveError("Failed to save highlight. Please try again.");
        return null;
      }
    },
    [selection, activeSelection, paperId]
  );

  const handleDismissSelection = useCallback(() => {
    setActiveSelection(null);
    clearSelection();
  }, [clearSelection]);

  const handleHighlight = useCallback(
    async (color: HighlightColor) => {
      await saveHighlight(color);
      setRefreshKey((k) => k + 1);
      postHighlightsChange({ paperId, source: "user" });
      setActiveSelection(null);
      clearSelection();
    },
    [saveHighlight, clearSelection, paperId]
  );

  const handleComment = useCallback(
    async (text: string) => {
      const id = await saveHighlight("yellow");
      if (id && text.trim()) {
        try {
          await fetch(`/api/user-highlights/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comment: text }),
          });
        } catch {
          setSaveError("Failed to save comment.");
        }
      }
      setRefreshKey((k) => k + 1);
      postHighlightsChange({ paperId, source: "user" });
      setActiveSelection(null);
      clearSelection();
    },
    [saveHighlight, clearSelection, paperId]
  );

  const handleCommitStart = useCallback(() => {
    if (selection) setActiveSelection(selection);
  }, [selection]);

  const deleteHighlight = useCallback(
    async (id: number | string): Promise<boolean> => {
      try {
        const isUser = typeof id === "number";
        const path = isUser
          ? `/api/user-highlights/${id}`
          : `/api/paper-highlights/${id}`;
        const res = await fetch(path, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setRefreshKey((k) => k + 1);
        postHighlightsChange({ paperId, source: isUser ? "user" : "ai" });
        return true;
      } catch {
        setSaveError("Failed to delete.");
        return false;
      }
    },
    [paperId]
  );

  const handleEraseHighlight = useCallback(async () => {
    const id = editingHighlight?.id;
    if (!id) return;
    await deleteHighlight(id);
    setEditingHighlight(null);
  }, [deleteHighlight, editingHighlight]);

  const handleSidebarDelete = useCallback(
    (id: number | string) => {
      void deleteHighlight(id);
    },
    [deleteHighlight]
  );

  const handleSidebarDeleteRun = useCallback(
    async (runId: string): Promise<boolean> => {
      try {
        const res = await fetch(
          `/api/papers/${paperId}/auto-highlight/runs/${runId}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setRefreshKey((k) => k + 1);
        postHighlightsChange({ paperId, source: "ai" });
        return true;
      } catch {
        setSaveError("Failed to delete highlight run.");
        return false;
      }
    },
    [paperId],
  );

  // Click delegation for existing-highlight overlays — opens toolbar in erase mode.
  useEffect(() => {
    const el = pdfScrollRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const hEl = target?.closest<HTMLElement>("[data-highlight-id]");
      if (!hEl) return;
      const idAttr = hEl.getAttribute("data-highlight-id");
      if (!idAttr) return;
      const parsed = Number.parseInt(idAttr, 10);
      const id: number | string = Number.isFinite(parsed) && String(parsed) === idAttr
        ? parsed
        : idAttr;
      e.stopPropagation();
      const domRect = hEl.getBoundingClientRect();
      setEditingHighlight({
        id,
        rect: {
          top: domRect.top,
          left: domRect.left,
          width: domRect.width,
          height: domRect.height,
        },
      });
      setActiveSelection(null);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!saveError) return;
    const timer = setTimeout(() => setSaveError(null), 3000);
    return () => clearTimeout(timer);
  }, [saveError]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveSelection(null);
        setEditingHighlight(null);
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection]);

  // Shared scroll-jump handler used by both the `episteme:reader-jump`
  // listener (in-app citation pills) and the `initialPage` prop effect
  // (BG2a deeplinks). Out-of-range pages are ignored when totalPages > 0.
  const performReaderJump = useCallback(
    (detail: {
      page?: number;
      bboxRect?: SegmentBbox | null;
      chunkId?: string | null;
    }) => {
      if (!detail?.page) return;
      const total = useReaderState.getState().totalPages;
      if (total > 0 && detail.page > total) return;
      useReaderState.getState().setScrollTargetPage(detail.page);
      const bbox = detail.bboxRect ?? null;
      if (!bbox) return;
      const container = pdfScrollRef.current;
      if (!container) return;
      scrollContainerToSegmentWithRetry(
        container,
        { page: detail.page!, bbox },
        {
          onSuccess: () => {
            if (detail.chunkId) {
              container.setAttribute("data-segment-flash", detail.chunkId);
              setTimeout(() => {
                if (container.getAttribute("data-segment-flash") === detail.chunkId) {
                  container.removeAttribute("data-segment-flash");
                }
              }, 1200);
            }
          },
        },
      );
    },
    [],
  );

  useEffect(() => {
    const onJump = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        page?: number;
        bboxRect?: SegmentBbox | null;
        chunkId?: string | null;
        orderIndex?: string | null;
      }>).detail;
      performReaderJump(detail);
    };
    window.addEventListener("episteme:reader-jump", onJump as EventListener);
    return () => window.removeEventListener("episteme:reader-jump", onJump as EventListener);
  }, [performReaderJump]);

  // BG2a follow-up — prop-based deeplink: dispatch the page jump once on
  // mount when `initialPage` is provided. Listener registration is guaranteed
  // because this effect lives inside Reader itself (no cross-component race).
  // Waits until totalPages is known so the upper-bound clamp can ignore
  // out-of-range deeplinks rather than landing on the last page.
  const initialPageConsumedRef = useRef(false);
  useEffect(() => {
    if (initialPageConsumedRef.current) return;
    if (initialPage === undefined) return;
    if (!Number.isFinite(initialPage) || initialPage < 1) return;
    const total = useReaderState.getState().totalPages;
    if (total === 0) return;
    initialPageConsumedRef.current = true;
    performReaderJump({ page: initialPage, bboxRect: null });
  }, [initialPage, performReaderJump]);

  // Subscribe to totalPages so the initialPage effect fires once PdfViewer
  // loads the document. The effect above is gated by getState() and only
  // consumes once — a subscription is needed because totalPages changes
  // outside React render flow.
  useEffect(() => {
    if (initialPage === undefined) return;
    if (initialPageConsumedRef.current) return;
    const unsub = useReaderState.subscribe((s) => {
      if (initialPageConsumedRef.current) return;
      if (s.totalPages <= 0) return;
      if (!Number.isFinite(initialPage) || initialPage < 1) {
        initialPageConsumedRef.current = true;
        return;
      }
      if (initialPage > s.totalPages) {
        initialPageConsumedRef.current = true;
        return;
      }
      initialPageConsumedRef.current = true;
      performReaderJump({ page: initialPage, bboxRect: null });
    });
    return unsub;
  }, [initialPage, performReaderJump]);

  useEffect(() => {
    if (!pendingScrollHighlightId) return;
    const target = mergedSidebarHighlights.find((h) => h.id === pendingScrollHighlightId);
    // Use the requested rect index — multi-rect highlights need to iterate
    // beyond rect[0] (Bug 2c). Fall back to rect[0] / pageNumber when no
    // rects are wired up so behaviour stays sane for legacy data.
    const rect = target?.rects?.[pendingScrollRectIndex] ?? target?.rects?.[0];
    const page = rect?.page ?? target?.pageNumber;
    if (page) useReaderState.getState().setScrollTargetPage(page);
    const id = pendingScrollHighlightId;
    const rIdx = pendingScrollRectIndex;
    // Consume-once: clear immediately so unrelated re-renders (e.g.,
    // mergedSidebarHighlights getting a fresh ref) don't re-fire the scroll.
    setPendingScrollHighlightId(null);
    setPendingScrollRectIndex(0);
    // The target page may not be mounted yet (virtualized PdfViewer). rAF
    // poll for the rect-indexed element so we land on the right rect even
    // when the page mounts late. Capped to ~500 ms.
    //
    // Rapid A→B clicks must invalidate A's in-flight poll, otherwise A and B
    // both fire scrollIntoView (codex R-B review). Increment the shared token
    // and capture it; the closure aborts whenever the ref drifts (newer
    // scroll, or unmount sentinel -1).
    const myToken = ++scrollTokenRef.current;
    let attempts = 0;
    const MAX_ATTEMPTS = 30;
    const tryScroll = () => {
      if (scrollTokenRef.current !== myToken) return;
      attempts += 1;
      const el = document.querySelector<HTMLElement>(
        `[data-highlight-id="${id}"][data-rect-index="${rIdx}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (attempts < MAX_ATTEMPTS) requestAnimationFrame(tryScroll);
    };
    requestAnimationFrame(tryScroll);
  }, [pendingScrollHighlightId, pendingScrollRectIndex, mergedSidebarHighlights]);

  // Unmount cleanup: invalidate any in-flight scroll-to-highlight rAF poll
  // (codex R-B review).
  useEffect(() => {
    return () => {
      scrollTokenRef.current = -1;
    };
  }, []);

  // Extract native PDF outline (bookmarks) when pdfDoc loads.
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    (async () => {
      const doc = pdfDoc as {
        getOutline: () => Promise<Array<{ title: string; dest: unknown; items?: unknown[] }> | null>;
        getPageIndex: (ref: unknown) => Promise<number>;
        getDestination: (name: string) => Promise<unknown[] | null>;
      };
      const normalize = async (items: unknown[]): Promise<PdfOutlineItem[]> =>
        Promise.all(
          (items ?? []).map(async (raw) => {
            const it = raw as { title?: string; dest?: unknown; items?: unknown[] };
            let pageIndex: number | null = null;
            try {
              if (Array.isArray(it.dest)) {
                pageIndex = await doc.getPageIndex(it.dest[0]);
              } else if (typeof it.dest === "string") {
                const resolved = await doc.getDestination(it.dest);
                if (resolved && Array.isArray(resolved)) {
                  pageIndex = await doc.getPageIndex(resolved[0]);
                }
              }
            } catch {
              /* leaves pageIndex null */
            }
            return {
              title: it.title ?? "",
              pageIndex,
              items: await normalize(it.items ?? []),
            };
          })
        );
      try {
        const raw = await doc.getOutline();
        const normalized = await normalize(raw ?? []);
        if (!cancelled) setPdfOutline(normalized.length > 0 ? normalized : null);
      } catch {
        if (!cancelled) setPdfOutline(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc]);

  type SidebarEntry = { id: string; dock: Dock; node: React.ReactNode };
  const entries: SidebarEntry[] = [];
  if (sidebarOpen) {
    entries.push({
      id: "highlights",
      dock: highlightsDock,
      node: (
        <HighlightsSidebar
          open={sidebarOpen}
          openToAiNonce={openHighlightsToAiNonce}
          aiHighlights={aiSidebarHighlights}
          userHighlights={sidebarHighlights.map((h) => ({ ...h, source: h.source ?? ("user" as const) }))}
          runs={allRuns}
          loading={highlightsLoading || aiHighlightsLoading}
          error={highlightsSidebarError}
          paperId={paperId}
          onNavigateHighlight={(id, rectIndex) => {
            setPendingScrollHighlightId(id);
            setPendingScrollRectIndex(rectIndex ?? 0);
          }}
          dockControl={
            <DockMenu
              dock={highlightsDock}
              onChange={setHighlightsDock}
              onClose={() => setSidebarOpen(false)}
            />
          }
          onDelete={handleSidebarDelete}
          onDeleteRun={handleSidebarDeleteRun}
          hiddenRunLayerIds={hiddenRunLayerIds}
          onToggleRunVisibility={toggleRunVisibility}
          hideAllUserHighlights={hideAllUserHighlights}
          onToggleAllUserHighlights={toggleAllUserHighlights}
        />
      ),
    });
  }
  if (outlineOpen) {
    entries.push({
      id: "outline",
      dock: outlineDock,
      node: (
        <OutlineSidebar
          totalPages={useReaderState.getState().totalPages}
          pdfOutline={pdfOutline}
          pdfDoc={pdfDoc}
          onNavigate={(page) => useReaderState.getState().setScrollTargetPage(page)}
          dockControl={
            <DockMenu
              dock={outlineDock}
              onChange={setOutlineDock}
              onClose={() => setOutlineOpen(false)}
            />
          }
        />
      ),
    });
  }
  if (citationsOpen) {
    entries.push({
      id: "citations",
      dock: citationsDock,
      node: (
        <CitationsSidebar
          paperId={paperId}
          open={citationsOpen}
          citations={citations}
          loading={citationsLoading}
          enriching={citationsEnriching}
          onExtracted={() => setCitationsRefreshKey((k) => k + 1)}
          onSaveToLibrary={handleSaveToLibrary}
          folders={folderOptions}
          dockControl={
            <DockMenu
              dock={citationsDock}
              onChange={setCitationsDock}
              onClose={() => setCitationsOpen(false)}
            />
          }
        />
      ),
    });
  }
  if (commentsOpen) {
    entries.push({
      id: "comments",
      dock: commentsDock,
      node: (
        <CommentsSidebar
          open={commentsOpen}
          highlights={sidebarHighlights}
          loading={highlightsLoading}
          error={commentsSidebarError}
          onNavigate={(page) => useReaderState.getState().setScrollTargetPage(page)}
          dockControl={
            <DockMenu
              dock={commentsDock}
              onChange={setCommentsDock}
              onClose={() => setCommentsOpen(false)}
            />
          }
          onDelete={handleSidebarDelete}
        />
      ),
    });
  }

  if (agentOpen && agentSlot != null) {
    entries.push({
      id: "agent",
      dock: agentDock,
      node: (
        <div className="flex h-full w-full flex-col bg-background">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="truncate text-sm font-semibold">Agent</h2>
            <DockMenu
              dock={agentDock}
              onChange={setAgentDock}
              onClose={() => setAgentOpen(false)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">{agentSlot}</div>
        </div>
      ),
    });
  }

  const leftEntries = entries.filter((e) => e.dock === "left");
  const rightEntries = entries.filter((e) => e.dock === "right");
  const bottomEntries = entries.filter((e) => e.dock === "bottom");

  const horizontalRow = (
    <Group orientation="horizontal" id="reader-horizontal" className="flex h-full w-full">
      {leftEntries.map((e, i) => (
        <SidebarPanelFragment
          key={e.id}
          panelId={`sidebar-${e.id}`}
          withBorderRight
          isFirst={i === 0}
          side="left"
        >
          {e.node}
        </SidebarPanelFragment>
      ))}
      <Panel
        id="pdf-viewer"
        minSize="30%"
        defaultSize="70%"
        data-testid="pdf-viewer-panel"
        className="relative flex h-full min-h-0 overflow-hidden"
      >
        <PdfViewer
          url={url}
          containerRef={pdfScrollRef}
          markers={markers}
          userHighlights={visibleHighlights}
          hiddenLayerIds={hiddenRunLayerIds}
          onPdfLoad={setPdfDoc}
        />
      </Panel>
      {rightEntries.map((e, i) => (
        <SidebarPanelFragment
          key={e.id}
          panelId={`sidebar-${e.id}`}
          withBorderLeft
          isFirst={i === 0}
          side="right"
        >
          {e.node}
        </SidebarPanelFragment>
      ))}
    </Group>
  );

  return (
    <div
      className={["flex h-full min-h-0 flex-col", className].filter(Boolean).join(" ")}
      data-reader-root
      data-reader-mode={mode}
    >
      <ReaderToolbar
        title={meta?.title ?? ""}
        backHref={`/p/${paperId}`}
        agentEnabled={agentSlot != null}
        agentOpen={agentOpen}
        onToggleAgent={() => setAgentOpen(!agentOpen)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        outlineOpen={outlineOpen}
        onToggleOutline={() => setOutlineOpen((o) => !o)}
        citationsOpen={citationsOpen}
        onToggleCitations={() => setCitationsOpen((o) => !o)}
        commentsOpen={commentsOpen}
        onToggleComments={() => setCommentsOpen((o) => !o)}
      />
      {(saveError || metaError) && (
        <div className="bg-destructive/10 text-destructive px-4 py-2 text-sm">
          {saveError ?? metaError}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {bottomEntries.length === 0 ? (
          horizontalRow
        ) : (
          <Group orientation="vertical" id="reader-vertical" className="flex h-full w-full">
            <Panel id="reader-main-row" minSize="40%" defaultSize="70%" className="min-h-0">
              {horizontalRow}
            </Panel>
            <Separator
              id="sep-bottom"
              className="h-1 cursor-row-resize bg-border data-[hover]:bg-primary/40"
            />
            <Panel
              id="reader-bottom-dock"
              minSize="120px"
              defaultSize="30%"
              className="flex w-full overflow-hidden border-t bg-background"
              data-testid="bottom-dock-panel"
            >
              <Group orientation="horizontal" id="reader-bottom-row" className="flex h-full w-full">
                {bottomEntries.map((e, i) => (
                  <SidebarPanelFragment
                    key={e.id}
                    panelId={`sidebar-${e.id}`}
                    withBorderLeft={i > 0}
                    isFirst={i === 0}
                    side="bottom"
                  >
                    {e.node}
                  </SidebarPanelFragment>
                ))}
              </Group>
            </Panel>
          </Group>
        )}
        {toolbarSelection && !editingHighlight && (
          <SelectionToolbar
            rect={toolbarSelection.rect}
            onHighlight={handleHighlight}
            onDismiss={handleDismissSelection}
            onComment={handleComment}
            onCommitStart={handleCommitStart}
            onExplain={
              onExplainPassage
                ? () => {
                    onExplainPassage({
                      page: toolbarSelection.pageNumber,
                      text: toolbarSelection.text,
                    });
                    setActiveSelection(null);
                    clearSelection();
                  }
                : undefined
            }
          />
        )}
        {editingHighlight && (
          <SelectionToolbar
            rect={editingHighlight.rect}
            editingHighlightId={editingHighlight.id}
            onHighlight={() => {
              /* TODO: recolor existing highlight */
            }}
            onDismiss={() => setEditingHighlight(null)}
            onErase={handleEraseHighlight}
          />
        )}
        {activeCitation && clickPosition && (
          <CitationCard
            citation={activeCitation}
            rect={clickPosition}
            onDismiss={dismissCitation}
            folders={folderOptions}
            onSaveToLibrary={(folderId) =>
              handleSaveToLibrary(activeCitation.id, folderId)
            }
          />
        )}
      </div>
    </div>
  );
}
