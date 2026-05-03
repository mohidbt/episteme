"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { toast } from "sonner";

import { ReaderToolbar } from "./ReaderToolbar";
import { SelectionToolbar, type HighlightColor } from "./SelectionToolbar";
import { HighlightsSidebar } from "./HighlightsSidebar";
import { CommentsSidebar } from "./CommentsSidebar";
import { OutlineSidebar, type PdfOutlineItem } from "./OutlineSidebar";
import { CitationsSidebar } from "./CitationsSidebar";
import { CitationCard, type CitationWithStatus } from "./CitationCard";
import { DockMenu, useSidebarDock, type Dock } from "./DockableSidebar";
import { FindBar } from "./FindBar";
import { PdfViewer } from "./PdfViewer";

import { usePdfDocument } from "../hooks/use-pdf-document";
import { usePdfFind } from "../hooks/use-pdf-find";
import { useTextSelection } from "../hooks/use-text-selection";
import { useReaderState } from "../hooks/use-reader-state";
import { useCitationClick } from "../hooks/use-citation-click";
import { useUserHighlights } from "../hooks/use-user-highlights";
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

export function Reader({ paperId, mode = "full", className, onExplainPassage }: ReaderProps) {
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
  const [refreshKey, setRefreshKey] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [citationsOpen, setCitationsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const pdfScrollRef = useRef<HTMLDivElement>(null);
  const { selection, clearSelection } = useTextSelection();

  type ActiveSelection = NonNullable<typeof selection>;
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);
  const [editingHighlight, setEditingHighlight] = useState<{
    id: number;
    rect: { top: number; left: number; width: number; height: number };
  } | null>(null);

  const [pdfOutline, setPdfOutline] = useState<PdfOutlineItem[] | null>(null);
  const [pdfDoc, setPdfDoc] = useState<unknown>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const find = usePdfFind(pdfDoc);

  // Per-sidebar dock position. Persisted via localStorage.
  const [highlightsDock, setHighlightsDock] = useSidebarDock("highlights", "right");
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

  const [markers, setMarkers] = useState<MarkerRect[]>([]);
  const [citationsRefreshKey, setCitationsRefreshKey] = useState(0);

  const {
    highlights: sidebarHighlights,
    userHighlights,
    loading: highlightsLoading,
    error: highlightsError,
  } = useUserHighlights(paperId, refreshKey);

  useEffect(() => {
    setCitationsLoading(true);
    fetch(`/api/papers/${paperId}/citations`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { citations: CitationWithStatus[] }) => setCitations(data.citations))
      .catch(() => {/* non-fatal */})
      .finally(() => setCitationsLoading(false));
  }, [paperId, citationsRefreshKey]);

  useEffect(() => {
    fetch(`/api/papers/${paperId}/citations/markers`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { markers: MarkerRect[] }) => setMarkers(data.markers))
      .catch(() => {/* non-fatal */});
  }, [paperId, citationsRefreshKey]);

  const patchCitation = useCallback(
    (citationId: number, patch: Partial<CitationWithStatus>) => {
      setCitations((prev) => prev.map((c) => (c.id === citationId ? { ...c, ...patch } : c)));
    },
    []
  );

  const handleKeep = useCallback(
    async (citationId: number) => {
      if (pendingCitationIds.current.has(citationId)) return;
      pendingCitationIds.current.add(citationId);
      try {
        const res = await fetch(`/api/papers/${paperId}/citations/${citationId}/keep`, {
          method: "POST",
        });
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
    },
    [paperId, patchCitation]
  );

  const handleSaveToLibrary = useCallback(
    async (citationId: number) => {
      if (pendingCitationIds.current.has(citationId)) return;
      pendingCitationIds.current.add(citationId);
      try {
        const res = await fetch(`/api/papers/${paperId}/citations/${citationId}/save`, {
          method: "POST",
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
      setActiveSelection(null);
      clearSelection();
    },
    [saveHighlight, clearSelection]
  );

  const handleCommitStart = useCallback(() => {
    if (selection) setActiveSelection(selection);
  }, [selection]);

  const deleteHighlight = useCallback(
    async (id: number): Promise<boolean> => {
      try {
        const res = await fetch(`/api/user-highlights/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setRefreshKey((k) => k + 1);
        return true;
      } catch {
        setSaveError("Failed to delete.");
        return false;
      }
    },
    []
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

  // Click delegation for existing-highlight overlays — opens toolbar in erase mode.
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
        setActiveSelection(null);
        setEditingHighlight(null);
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection]);

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
          highlights={sidebarHighlights}
          loading={highlightsLoading}
          error={highlightsError}
          dockControl={
            <DockMenu
              dock={highlightsDock}
              onChange={setHighlightsDock}
              onClose={() => setSidebarOpen(false)}
            />
          }
          onDelete={handleSidebarDelete}
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
          onExtracted={() => setCitationsRefreshKey((k) => k + 1)}
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
          error={highlightsError}
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
          userHighlights={userHighlights}
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
      <FindBar
        open={findOpen}
        matchCase={matchCase}
        onSearch={(q, opts) => find.search(q, opts)}
        onNext={find.next}
        onPrev={find.prev}
        onToggleCase={() => setMatchCase((v) => !v)}
        onClose={() => setFindOpen(false)}
      />
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
            onKeep={() => handleKeep(activeCitation.id)}
            onSaveToLibrary={() => handleSaveToLibrary(activeCitation.id)}
          />
        )}
      </div>
    </div>
  );
}
