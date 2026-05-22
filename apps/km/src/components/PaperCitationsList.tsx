"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CitationCard,
  type CitationWithStatus,
  type FolderOption,
} from "@episteme/reader/citation-card";

interface PaperCitationsListProps {
  paperId: string;
}

type CitationRow = CitationWithStatus & {
  matchedPaperId?: string | null;
  citedInCount?: number;
  citingCount?: number;
};

interface CitationsResponse {
  citations: CitationRow[];
}

export function citationsRefreshEvent(paperId: string): string {
  return `paper-citations-refresh:${paperId}`;
}

export function PaperCitationsList({ paperId }: PaperCitationsListProps) {
  const [rows, setRows] = useState<CitationRow[] | null>(null);
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pendingIds = useRef<Set<number>>(new Set());

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/papers/${paperId}/citations`, {
          credentials: "include",
          signal,
        });
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as CitationsResponse;
        setError(null);
        setRows(data.citations ?? []);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
      }
    },
    [paperId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    function onRefresh() {
      setRefreshing(true);
      load().finally(() => setRefreshing(false));
    }
    const evt = citationsRefreshEvent(paperId);
    window.addEventListener(evt, onRefresh);
    return () => window.removeEventListener(evt, onRefresh);
  }, [paperId, load]);

  // Folder picker source — mirrors Reader.tsx filter rules (hide Trash,
  // `.episteme/*`, and any `.`-prefixed system folder).
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/folders`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: {
        folders?: { id: string; name: string; parentId: string | null; isTrash: boolean }[];
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
            cur = byId.get(cur)?.parentId ?? null;
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
        setFolders(visible);
      })
      .catch(() => {/* non-fatal */});
    return () => ctl.abort();
  }, []);

  const patchCitation = useCallback((citationId: number, patch: Partial<CitationRow>) => {
    setRows((prev) => prev?.map((c) => (c.id === citationId ? { ...c, ...patch } : c)) ?? prev);
  }, []);

  const handleSave = useCallback(
    async (citationId: number, folderId: string | null) => {
      if (pendingIds.current.has(citationId)) return;
      pendingIds.current.add(citationId);
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
        pendingIds.current.delete(citationId);
      }
    },
    [paperId, patchCitation],
  );

  return (
    <section className="flex flex-col gap-3" data-testid="paper-citations-section">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Citations{rows ? ` · ${rows.length}` : ""}
        </p>
        {refreshing && (
          <span className="text-[11px] text-muted-foreground">Extracting…</span>
        )}
      </div>
      {error ? (
        <p className="text-sm text-muted-foreground">Couldn&rsquo;t load citations.</p>
      ) : rows === null ? (
        <p className="text-sm text-muted-foreground">Loading&hellip;</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No citations yet. Click &ldquo;Find citations&rdquo; to extract.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="paper-citations-list">
          {rows.map((c) => (
            <li key={c.id}>
              <CitationCard
                citation={c}
                variant="compact"
                matchedPaperId={c.matchedPaperId ?? null}
                citedInCount={c.citedInCount ?? 0}
                citingCount={c.citingCount ?? 0}
                folders={folders}
                onSaveToLibrary={(folderId) => handleSave(c.id, folderId)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
