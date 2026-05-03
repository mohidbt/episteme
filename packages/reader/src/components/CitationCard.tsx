"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { X, Star, ExternalLink, Folder } from "lucide-react";
import type { documentReferences } from "@episteme/db/schema";
import type { InferSelectModel } from "drizzle-orm";
import { toast } from "sonner";
import { formatBibtex } from "../lib/citations/bibtex";

export type DocumentReference = InferSelectModel<typeof documentReferences>;

export interface CitationWithStatus extends DocumentReference {
  keptId: number | null;
  libraryReferenceId: number | null;
  /** isOpenAccess from S2 API — not stored in DB, optionally passed through */
  isOpenAccess?: boolean | null;
}

export type CitationCardVariant = "popover" | "compact";

export interface FolderOption {
  id: string;
  name: string;
  /** Pre-formatted breadcrumb, e.g. "Reading / 2026 / Causal" */
  path?: string;
}

interface CitationCardProps {
  citation: CitationWithStatus;
  rect?: { top: number; left: number };
  onDismiss?: () => void;
  /**
   * Save the citation as a library reference. Optional folderId places it in
   * the chosen folder; null/undefined keeps it at the library root.
   */
  onSaveToLibrary?: (folderId: string | null) => void;
  /** Folders shown in the side picker. Empty → no picker rendered. */
  folders?: FolderOption[];
  variant?: CitationCardVariant;
  headerAction?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// External-ID pill config
// ---------------------------------------------------------------------------

type PillConfig = { label: string; url: (id: string) => string };

const PILL_MAP: Record<string, PillConfig> = {
  DOI: { label: "DOI", url: (id) => `https://doi.org/${id}` },
  ArXiv: { label: "arXiv", url: (id) => `https://arxiv.org/abs/${id}` },
  PubMed: { label: "PubMed", url: (id) => `https://pubmed.ncbi.nlm.nih.gov/${id}/` },
  ACL: { label: "ACL", url: (id) => `https://aclanthology.org/${id}` },
  DBLP: { label: "DBLP", url: (id) => `https://dblp.org/rec/${id}` },
  PMC: { label: "PMC", url: (id) => `https://ncbi.nlm.nih.gov/pmc/articles/${id}` },
};

// ---------------------------------------------------------------------------
// CitationCard
// ---------------------------------------------------------------------------

export function CitationCard({
  citation,
  rect,
  onDismiss,
  onSaveToLibrary,
  folders = [],
  variant = "popover",
  headerAction,
}: CitationCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const [leftPos, setLeftPos] = useState<number>(rect?.left ?? 0);
  const [abstractExpanded, setAbstractExpanded] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);

  // Close folder menu on outside click.
  useEffect(() => {
    if (!folderMenuOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (
        folderMenuRef.current &&
        !folderMenuRef.current.contains(e.target as Node)
      ) {
        setFolderMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [folderMenuOpen]);

  const isPopover = variant === "popover";

  // Dismiss on click outside or Escape key (popover mode only)
  useEffect(() => {
    if (!isPopover || !onDismiss) return;
    const dismiss = onDismiss;

    function handleMouseDown(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        dismiss();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onDismiss, isPopover]);

  // Clamp card to viewport (popover mode only)
  useEffect(() => {
    if (!isPopover || !rect) return;
    setLeftPos(Math.min(rect.left, window.innerWidth - 336));
  }, [rect, isPopover]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const title = citation.title ?? citation.rawText ?? citation.markerText;

  // Title link
  const titleHref = citation.semanticScholarId
    ? `https://www.semanticscholar.org/paper/${citation.semanticScholarId}`
    : citation.doi
    ? `https://doi.org/${citation.doi}`
    : null;

  // Authors
  const authors = citation.authors ?? [];

  // Metrics
  const showOaBadge = !!(citation.openAccessPdfUrl || citation.isOpenAccess);

  // External ID pills
  const pills = Object.entries(citation.externalIds ?? {}).flatMap(([key, id]) => {
    const cfg = PILL_MAP[key];
    return cfg ? [{ key, label: cfg.label, href: cfg.url(id) }] : [];
  });

  // BibTeX
  async function handleCopyBibtex() {
    const bibtex =
      citation.bibtex ??
      formatBibtex({
        paperId: citation.semanticScholarId,
        doi: citation.doi,
        title: citation.title,
        authors: citation.authors,
        year: citation.year ? Number(citation.year) : null,
        venue: citation.venue,
      });
    try {
      await navigator.clipboard.writeText(bibtex);
      toast.success("BibTeX copied");
    } catch {
      toast.error("Failed to copy BibTeX");
    }
  }

  // ---------------------------------------------------------------------------
  // Variant-dependent classes
  // ---------------------------------------------------------------------------

  const padding = isPopover ? "p-4" : "p-3";
  const headerPadding = isPopover ? "px-4 py-3" : "px-3 py-2";
  const titleClass = isPopover ? "text-base" : "text-sm";
  const abstractClamp = isPopover ? "line-clamp-3" : "line-clamp-2";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={cardRef}
      role={isPopover ? "dialog" : undefined}
      aria-label={isPopover ? "Citation details" : undefined}
      className={isPopover
        ? "fixed z-50 w-80 rounded-lg border bg-background shadow-xl"
        : "rounded-lg border bg-background"}
      style={isPopover && rect ? { top: rect.top, left: Math.max(8, leftPos) } : undefined}
    >
      {/* Header: title + close button (popover only) */}
      <div className={`flex items-center justify-between gap-2 border-b ${headerPadding}`}>
        <div className="flex min-w-0 items-center gap-2">
          {citation.markerIndex > 0 && (
            <span
              aria-hidden
              className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-muted px-1.5 text-[11px] font-medium tabular-nums leading-none text-muted-foreground"
            >
              {citation.markerIndex}
            </span>
          )}
          {titleHref ? (
            <a
              href={titleHref}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="citation-title"
              className={`font-semibold leading-5 text-foreground hover:underline line-clamp-3 ${titleClass}`}
            >
              {title}
            </a>
          ) : (
            <p
              data-testid="citation-title"
              className={`font-semibold leading-5 text-foreground line-clamp-3 ${titleClass}`}
            >
              {title}
            </p>
          )}
        </div>
        {isPopover && onDismiss && (
          <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Close" className="shrink-0">
            <X data-icon="inline-start" />
          </Button>
        )}
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>

      {/* Body */}
      <div className={`flex flex-col gap-1.5 ${padding}`}>
        {/* Authors */}
        {authors.length > 0 && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {authors.map((author, i) => {
              const authorEl = author.authorId ? (
                <a
                  key={author.name}
                  href={`https://www.semanticscholar.org/author/${author.authorId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {author.name}
                </a>
              ) : (
                <span key={author.name}>{author.name}</span>
              );
              return i < authors.length - 1 ? (
                <span key={`${author.name}-wrap`}>{authorEl}{", "}</span>
              ) : authorEl;
            })}
          </p>
        )}

        {/* Metrics line: Venue · Year · citations · OA badge */}
        {(citation.venue || citation.year || citation.citationCount != null || showOaBadge) && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            {citation.venue && <span className="italic">{citation.venue}</span>}
            {citation.venue && citation.year && <span aria-hidden>·</span>}
            {citation.year && <span>{citation.year}</span>}
            {(citation.venue || citation.year) && citation.citationCount != null && (
              <span aria-hidden>·</span>
            )}
            {citation.citationCount != null && (
              <span className="inline-flex items-center gap-0.5">
                <Star className="size-3" aria-hidden />
                {citation.citationCount}
                {(citation.influentialCitationCount ?? 0) > 0 && (
                  <span className="ml-1 text-muted-foreground/70">
                    ({citation.influentialCitationCount} influential)
                  </span>
                )}
              </span>
            )}
            {showOaBadge && (
              <Badge variant="secondary" title="Open Access PDF available">OA</Badge>
            )}
          </div>
        )}

        {/* TL;DR */}
        {citation.tldrText && (
          <p
            title={citation.tldrText}
            className="text-xs italic text-muted-foreground truncate"
          >
            {citation.tldrText}
          </p>
        )}

        {/* Abstract (collapsible) */}
        {citation.abstract && (
          <div className="pt-0.5">
            <p
              className={`text-xs text-foreground/80 leading-relaxed ${abstractExpanded ? "" : abstractClamp}`}
            >
              {citation.abstract}
            </p>
            <button
              type="button"
              onClick={() => setAbstractExpanded((v) => !v)}
              className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {abstractExpanded ? "Show less" : "Show more"}
            </button>
          </div>
        )}

        {/* External-ID pills */}
        {pills.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {pills.map(({ key, label, href }) => (
              <Badge
                key={key}
                variant="outline"
                className="text-[10px]"
                render={<a href={href} target="_blank" rel="noopener noreferrer" />}
              >
                {label}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className={`flex flex-wrap gap-2 border-t ${headerPadding}`}>
        {/* Save to Library — primary action with side folder picker */}
        {onSaveToLibrary !== undefined && (
          <div className="relative inline-flex flex-1 isolate">
            <Button
              size="sm"
              variant={citation.libraryReferenceId ? "secondary" : "default"}
              className={
                folders.length > 0
                  ? "flex-1 rounded-r-none border-r-0 text-xs"
                  : "flex-1 text-xs"
              }
              onClick={() => onSaveToLibrary(null)}
              disabled={!!citation.libraryReferenceId}
              aria-label={
                citation.libraryReferenceId
                  ? "Already in library"
                  : "Save to library"
              }
            >
              {citation.libraryReferenceId ? "In Library ✓" : "Save to Library"}
            </Button>
            {folders.length > 0 && !citation.libraryReferenceId && (
              <div ref={folderMenuRef} className="relative">
                <Button
                  size="sm"
                  variant="default"
                  className="rounded-l-none border-l border-l-background/30 px-2"
                  onClick={() => setFolderMenuOpen((v) => !v)}
                  aria-label="Pick folder for save"
                  aria-haspopup="menu"
                  aria-expanded={folderMenuOpen}
                >
                  <Folder className="size-3.5" aria-hidden />
                </Button>
                {folderMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-[60] mt-1 max-h-64 w-56 overflow-y-auto rounded-md border bg-background p-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setFolderMenuOpen(false);
                        onSaveToLibrary(null);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                    >
                      <span className="flex-1 truncate">Library root</span>
                    </button>
                    {folders.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setFolderMenuOpen(false);
                          onSaveToLibrary(f.id);
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                      >
                        <Folder className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="flex-1 truncate" title={f.path ?? f.name}>
                          {f.path ?? f.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* Copy BibTeX */}
        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs"
          onClick={handleCopyBibtex}
          aria-label="Copy BibTeX"
        >
          Copy BibTeX
        </Button>
        {/* Open PDF */}
        {citation.openAccessPdfUrl && (
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs"
            render={
              <a
                href={citation.openAccessPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open PDF"
              />
            }
          >
            <ExternalLink data-icon="inline-start" />
            Open PDF
          </Button>
        )}
      </div>
    </div>
  );
}
