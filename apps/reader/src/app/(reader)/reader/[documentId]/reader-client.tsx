"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { ReaderToolbar } from "@/components/reader/reader-toolbar";
import { SelectionToolbar, type HighlightColor } from "@/components/reader/selection-toolbar";
import { HighlightsSidebar } from "@/components/reader/highlights-sidebar";
import { CommentsSidebar } from "@/components/reader/comments-sidebar";
import { ChatPanel, type ChatSeed } from "@/components/reader/chat-panel";
import { OutlineSidebar, type PdfOutlineItem } from "@/components/reader/outline-sidebar";
import { CitationCard, type CitationWithStatus } from "@/components/reader/citation-card";
import { CitationsSidebar } from "@/components/reader/citations-sidebar";
import { DockMenu, useSidebarDock, type Dock } from "@/components/reader/dockable-sidebar";
import { Group, Panel, Separator } from "react-resizable-panels";
import { FindBar } from "@/components/reader/find-bar";
import { usePdfFind } from "@/hooks/use-pdf-find";
import { toast } from "sonner";
import { useTextSelection } from "@/hooks/use-text-selection";
import { useReaderState } from "@/hooks/use-reader-state";
import { useCitationClick } from "@/hooks/use-citation-click";
import { useUserHighlights } from "@/hooks/use-user-highlights";
import { useAIHighlightRuns } from "@/hooks/use-ai-highlight-runs";
import { useSegments } from "@/hooks/use-segments";
import { buildExplainSeed } from "@/lib/reader/explain-seed";

const PdfViewer = dynamic(
  () => import("@/components/reader/pdf-viewer").then((m) => ({ default: m.PdfViewer })),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center bg-muted/30">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading PDF...</p>
        </div>
      </div>
    ),
  }
);

type DocProcessingStatus = "pending" | "processing" | "ready" | "failed";

interface ReaderClientProps {
  documentId: number;
  title: string;
  processingStatus: DocProcessingStatus;
}

/**
 * Renders a Separator + Panel pair as a fragment so callers can place
 * sidebar panels alongside the PDF panel inside a single Group. The
 * separator is positioned on the side facing the PDF (right of left dock,
 * left of right dock, top of bottom dock).
 *
 * minSize 280px enforces the "header stays on one line" rule.
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
  // `react-resizable-panels` v4: numbers = pixels, strings = percentages
  // (or explicit "Npx"). We want a hard pixel floor but a relative default.
  const minSize = side === "bottom" ? "120px" : "280px";
  const defaultSize = side === "bottom" ? "30%" : "25%";
  // Separator goes on the side facing the PDF: right of a left-docked
  // sidebar, left of a right-docked sidebar, between stacked panels.
  const sepClass =
    side === "bottom"
      ? "w-1 cursor-col-resize bg-border data-[hover]:bg-primary/40"
      : "w-1 cursor-col-resize bg-border data-[hover]:bg-primary/40";
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
    // Panel first, then separator (separator sits between sidebar and PDF).
    return (
      <>
        {panel}
        <Separator id={`sep-${panelId}`} className={sepClass} />
      </>
    );
  }
  if (side === "right") {
    // Separator first (between PDF and sidebar), then panel.
    return (
      <>
        <Separator id={`sep-${panelId}`} className={sepClass} />
        {panel}
      </>
    );
  }
  // Bottom dock: stacked horizontally; separators between only.
  if (isFirst) return panel;
  return (
    <>
      <Separator id={`sep-${panelId}`} className={sepClass} />
      {panel}
    </>
  );
}

export function ReaderClient({ documentId, title, processingStatus }: ReaderClientProps) {
  const url = `/api/documents/${documentId}/file`;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [citationsOpen, setCitationsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const pdfScrollRef = useRef<HTMLDivElement>(null);
  const { selection, clearSelection } = useTextSelection();
  // Snapshot of `selection` taken when the user enters a long-lived
  // sub-mode (e.g. clicking Comment). The toolbar must survive the
  // selectionchange that fires when focus shifts to the popup, so we
  // pin the selection here and keep rendering the toolbar from this
  // snapshot until Save / Cancel / Escape clears it.
  type ActiveSelection = NonNullable<typeof selection>;
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);
  // When the user clicks an existing highlight overlay, surface the
  // selection toolbar in "edit existing highlight" mode so they can erase
  // it. A synthetic rect is stored purely for toolbar positioning.
  const [editingHighlight, setEditingHighlight] = useState<{
    id: number;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);
  const currentPage = useReaderState((s) => s.currentPage);
  const totalPages = useReaderState((s) => s.totalPages);
  const [pdfOutline, setPdfOutline] = useState<PdfOutlineItem[] | null>(null);
  const [pdfDoc, setPdfDoc] = useState<unknown>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const find = usePdfFind(pdfDoc);
  const [chatSeed, setChatSeed] = useState<ChatSeed | null>(null);

  // Per-sidebar dock position. Persisted via localStorage by useSidebarDock.
  const [highlightsDock, setHighlightsDock] = useSidebarDock("highlights", "right");
  const [chatDock, setChatDock] = useSidebarDock("chat", "right");
  const [outlineDock, setOutlineDock] = useSidebarDock("outline", "left");
  const [citationsDock, setCitationsDock] = useSidebarDock("citations", "right");
  const [commentsDock, setCommentsDock] = useSidebarDock("comments", "right");

  // Citations
  const [citations, setCitations] = useState<CitationWithStatus[]>([]);
  const [citationsLoading, setCitationsLoading] = useState(true);
  const pendingCitationIds = useRef<Set<number>>(new Set());
  const { activeCitation, clickPosition, dismiss: dismissCitation } = useCitationClick(
    pdfScrollRef,
    citations
  );

  type MarkerRect = {
    id: number;
    referenceId: number;
    markerIndex: number;
    pageNumber: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  const [markers, setMarkers] = useState<MarkerRect[]>([]);
  const [citationsRefreshKey, setCitationsRefreshKey] = useState(0);

  // User highlights — fetched at page level so overlay + sidebar share state
  const {
    highlights: sidebarHighlights,
    userHighlights,
    loading: highlightsLoading,
    error: highlightsError,
  } = useUserHighlights(documentId, refreshKey);

  // Document segments (section_header, figure, formula) for explain markers
  const { segments } = useSegments(documentId);

  const handleExplainClick = useCallback(
    (segmentId: number) => {
      const seg = segments.find((s) => s.id === segmentId);
      if (!seg) return;
      setChatSeed({
        text: buildExplainSeed(seg),
        pageNumber: seg.page + 1,
        scope: "segment",
        nonce: Date.now(),
      });
      setChatOpen(true);
    },
    [segments]
  );

  // AI auto-highlight runs — fetched at page level so the sidebar Runs section
  // stays in sync with overlay filtering. `refreshKey` re-fetches after delete.
  const {
    runs: aiRuns,
    hiddenRunIds,
    toggleRun,
    ensureVisible: ensureRunVisible,
    deleteRun,
    rebuildRun,
    rebuildingRunId,
  } = useAIHighlightRuns(documentId, refreshKey);

  const handleReviewRun = useCallback(
    (runId: string) => {
      ensureRunVisible(runId);
      setSidebarOpen(true);
    },
    [ensureRunVisible]
  );

  useEffect(() => {
    setCitationsLoading(true);
    fetch(`/api/documents/${documentId}/citations`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: { citations: CitationWithStatus[] }) => setCitations(data.citations))
      .catch(() => {/* non-fatal: citations just won't show */})
      .finally(() => setCitationsLoading(false));
  }, [documentId, citationsRefreshKey]);

  useEffect(() => {
    fetch(`/api/documents/${documentId}/citations/markers`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: { markers: MarkerRect[] }) => setMarkers(data.markers))
      .catch(() => {/* non-fatal: overlays just won't show */});
  }, [documentId, citationsRefreshKey]);

  const patchCitation = useCallback(
    (citationId: number, patch: Partial<CitationWithStatus>) => {
      setCitations((prev) =>
        prev.map((c) => (c.id === citationId ? { ...c, ...patch } : c))
      );
    },
    []
  );

  const handleKeep = useCallback(async (citationId: number) => {
    // Guard against double-submit from rapid clicks
    if (pendingCitationIds.current.has(citationId)) return;
    pendingCitationIds.current.add(citationId);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/citations/${citationId}/keep`,
        { method: "POST" }
      );
      if (res.ok) {
        const { keptId } = (await res.json()) as { keptId: number };
        patchCitation(citationId, { keptId });
        toast.success("Kept");
      } else {
        toast.error("Failed to keep citation");
      }
    } finally {
      pendingCitationIds.current.delete(citationId);
    }
  }, [documentId, patchCitation]);

  const handleSaveToLibrary = useCallback(async (citationId: number) => {
    if (pendingCitationIds.current.has(citationId)) return;
    pendingCitationIds.current.add(citationId);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/citations/${citationId}/save`,
        { method: "POST" }
      );
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
  }, [documentId, patchCitation]);

  // Toolbar reads from snapshot if present, else live selection.
  const toolbarSelection = activeSelection ?? selection;

  // `color` is typically a user-selected HighlightColor, but the comment
  // flow persists with "yellow" (reserved for comment overlays, not in the
  // picker palette).
  const saveHighlight = useCallback(
    async (color: HighlightColor | "yellow"): Promise<number | null> => {
      const sel = activeSelection ?? selection;
      if (!sel) return null;
      setSaveError(null);
      try {
        const res = await fetch(`/api/documents/${documentId}/highlights`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
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
    [selection, activeSelection, documentId]
  );

  const handleDismissSelection = useCallback(() => {
    setActiveSelection(null);
    clearSelection();
  }, [clearSelection]);

  const handleHighlight = useCallback(
    async (color: HighlightColor) => {
      await saveHighlight(color);
      setRefreshKey((k) => k + 1);
      setActiveSelection(null);
      clearSelection();
    },
    [saveHighlight, clearSelection]
  );

  const handleComment = useCallback(
    async (text: string) => {
      const id = await saveHighlight("yellow");
      if (id && text.trim()) {
        try {
          await fetch(`/api/documents/${documentId}/highlights/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comment: text }),
          });
        } catch {
          setSaveError("Failed to save comment.");
        }
      }
      setRefreshKey((k) => k + 1);
      setActiveSelection(null);
      clearSelection();
    },
    [saveHighlight, documentId, clearSelection]
  );

  const handleAskAi = useCallback(() => {
    const sel = activeSelection ?? selection;
    if (!sel) return;
    setChatSeed({
      text: sel.text,
      pageNumber: sel.pageNumber,
      scope: "selection",
      nonce: Date.now(),
    });
    setChatOpen(true);
    setActiveSelection(null);
    clearSelection();
  }, [selection, activeSelection, clearSelection]);

  const handleCommitStart = useCallback(() => {
    // Pin the current selection so the toolbar stays mounted even after
    // focus shifts and the window selection clears.
    if (selection) setActiveSelection(selection);
  }, [selection]);

  const deleteHighlight = useCallback(
    async (id: number): Promise<boolean> => {
      try {
        const res = await fetch(`/api/documents/${documentId}/highlights/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setRefreshKey((k) => k + 1);
        return true;
      } catch {
        setSaveError("Failed to delete.");
        return false;
      }
    },
    [documentId]
  );

  const handleEraseHighlight = useCallback(async () => {
    const id = editingHighlight?.id;
    if (!id) return;
    await deleteHighlight(id);
    setEditingHighlight(null);
  }, [deleteHighlight, editingHighlight]);

  const handleSidebarDelete = useCallback(
    (id: number) => {
      void deleteHighlight(id);
    },
    [deleteHighlight]
  );

  // Event delegation: catch clicks on UserHighlightLayer overlay rects and
  // open the selection toolbar in "edit existing highlight" mode. Scoped to
  // the PDF scroll container so it doesn't interfere with other UI.
  useEffect(() => {
    const el = pdfScrollRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const hEl = target?.closest<HTMLElement>("[data-highlight-id]");
      if (!hEl) return;
      const idAttr = hEl.getAttribute("data-highlight-id");
      const id = idAttr ? parseInt(idAttr, 10) : NaN;
      if (!Number.isFinite(id)) return;
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
      // Clear any stray text selection so the new toolbar takes over.
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
      }
      if (e.key === "Escape") {
        // Escape dismisses any active selection toolbar (incl. comment popup)
        // and exits "edit existing highlight" mode.
        setActiveSelection(null);
        setEditingHighlight(null);
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection]);

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

  return (
    <div className="flex h-screen flex-col">
      <ReaderToolbar
        title={title}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        chatOpen={chatOpen}
        onToggleChat={() => {
          setChatOpen((o) => {
            if (o) setChatSeed(null);
            return !o;
          });
        }}
        outlineOpen={outlineOpen}
        onToggleOutline={() => setOutlineOpen((o) => !o)}
        citationsOpen={citationsOpen}
        onToggleCitations={() => setCitationsOpen((o) => !o)}
        commentsOpen={commentsOpen}
        onToggleComments={() => setCommentsOpen((o) => !o)}
      />
      {saveError && (
        <div className="bg-destructive/10 text-destructive px-4 py-2 text-sm">
          {saveError}
        </div>
      )}
      <FindBar
        open={findOpen}
        matchCase={matchCase}
        onSearch={(q, opts) => find.search(q, opts)}
        onNext={find.next}
        onPrev={find.prev}
        onToggleCase={() => setMatchCase((v) => !v)}
        onClose={() => setFindOpen(false)}
      />
      <div className="relative flex flex-1 overflow-hidden">
        {(() => {
          // Build a map of sidebar-id → rendered node + dock position.
          // Each sidebar is rendered with its own DockMenu so the user can
          // re-dock from inside the panel header (no abs-positioned ⋮).
          type SidebarEntry = {
            id: string;
            dock: Dock;
            node: React.ReactNode;
          };
          const entries: SidebarEntry[] = [];
          if (sidebarOpen) {
            entries.push({
              id: "highlights",
              dock: highlightsDock,
              node: (
                <HighlightsSidebar
                  open={sidebarOpen}
                  highlights={sidebarHighlights}
                  loading={highlightsLoading}
                  error={highlightsError}
                  dockControl={<DockMenu dock={highlightsDock} onChange={setHighlightsDock} onClose={() => setSidebarOpen(false)} />}
                  onAskAi={(text, pageNumber) => {
                    setChatSeed({
                      text,
                      pageNumber,
                      scope: "selection",
                      nonce: Date.now(),
                    });
                    setChatOpen(true);
                  }}
                  onDelete={handleSidebarDelete}
                  runs={aiRuns}
                  hiddenRunIds={hiddenRunIds}
                  onToggleRun={toggleRun}
                  onDeleteRun={(runId) =>
                    void deleteRun(runId, () => setRefreshKey((k) => k + 1))
                  }
                  onRebuildRun={(runId) =>
                    void rebuildRun(runId, () => setRefreshKey((k) => k + 1))
                  }
                  rebuildingRunId={rebuildingRunId}
                />
              ),
            });
          }
          if (chatOpen) {
            entries.push({
              id: "chat",
              dock: chatDock,
              node: (
                <ChatPanel
                  documentId={documentId}
                  open={chatOpen}
                  scrollContainerRef={pdfScrollRef}
                  seed={chatSeed}
                  onClearSeed={() => setChatSeed(null)}
                  dockControl={<DockMenu dock={chatDock} onChange={setChatDock} onClose={() => setChatOpen(false)} />}
                  currentPage={currentPage}
                  processingStatus={processingStatus}
                  onHighlightsChanged={() => setRefreshKey((k) => k + 1)}
                  onReviewRun={handleReviewRun}
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
                  totalPages={totalPages}
                  pdfOutline={pdfOutline}
                  pdfDoc={pdfDoc}
                  onNavigate={(page) => useReaderState.getState().setScrollTargetPage(page)}
                  dockControl={<DockMenu dock={outlineDock} onChange={setOutlineDock} onClose={() => setOutlineOpen(false)} />}
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
                  documentId={documentId}
                  open={citationsOpen}
                  citations={citations}
                  loading={citationsLoading}
                  onExtracted={() => setCitationsRefreshKey((k) => k + 1)}
                  dockControl={<DockMenu dock={citationsDock} onChange={setCitationsDock} onClose={() => setCitationsOpen(false)} />}
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
                  error={highlightsError}
                  onNavigate={(page) => useReaderState.getState().setScrollTargetPage(page)}
                  dockControl={<DockMenu dock={commentsDock} onChange={setCommentsDock} onClose={() => setCommentsOpen(false)} />}
                  onAskAi={(text, pageNumber) => {
                    setChatSeed({
                      text,
                      pageNumber,
                      scope: "selection",
                      nonce: Date.now(),
                    });
                    setChatOpen(true);
                  }}
                  onDelete={handleSidebarDelete}
                />
              ),
            });
          }

          const leftEntries = entries.filter((e) => e.dock === "left");
          const rightEntries = entries.filter((e) => e.dock === "right");
          const bottomEntries = entries.filter((e) => e.dock === "bottom");

          // Horizontal row: [left sidebars] | PDF | [right sidebars]
          const horizontalRow = (
            <Group
              orientation="horizontal"
              id="reader-horizontal"
              className="flex h-full w-full"
            >
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
                className="relative flex h-full overflow-hidden"
              >
                <PdfViewer
                  url={url}
                  containerRef={pdfScrollRef}
                  markers={markers}
                  userHighlights={userHighlights}
                  hiddenLayerIds={hiddenRunIds}
                  segments={segments}
                  onExplainClick={handleExplainClick}
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

          if (bottomEntries.length === 0) {
            return horizontalRow;
          }

          // Vertical wrap: horizontalRow on top, bottom-docked sidebars below.
          return (
            <Group
              orientation="vertical"
              id="reader-vertical"
              className="flex h-full w-full"
            >
              <Panel id="reader-main-row" minSize="40%" defaultSize="70%">
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
          );
        })()}
        {toolbarSelection && !editingHighlight && (
          <SelectionToolbar
            rect={toolbarSelection.rect}
            onHighlight={handleHighlight}
            onDismiss={handleDismissSelection}
            onComment={handleComment}
            onAskAi={handleAskAi}
            onCommitStart={handleCommitStart}
          />
        )}
        {editingHighlight && (
          <SelectionToolbar
            rect={editingHighlight.rect}
            editingHighlightId={editingHighlight.id}
            onHighlight={() => {
              // TODO: recolor an existing highlight. For now, no-op to keep
              // the picker visually consistent while erase is the primary
              // action in edit mode.
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
            onKeep={() => handleKeep(activeCitation.id)}
            onSaveToLibrary={() => handleSaveToLibrary(activeCitation.id)}
          />
        )}
      </div>
    </div>
  );
}
