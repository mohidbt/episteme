"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useReaderState } from "@/hooks/use-reader-state";
import { ZoomControls } from "./zoom-controls";

interface ReaderToolbarProps {
  title: string;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  chatOpen?: boolean;
  onToggleChat?: () => void;
  outlineOpen?: boolean;
  onToggleOutline?: () => void;
  citationsOpen?: boolean;
  onToggleCitations?: () => void;
  commentsOpen?: boolean;
  onToggleComments?: () => void;
}

export function ReaderToolbar({
  title,
  sidebarOpen,
  onToggleSidebar,
  chatOpen,
  onToggleChat,
  outlineOpen,
  onToggleOutline,
  citationsOpen,
  onToggleCitations,
  commentsOpen,
  onToggleComments,
}: ReaderToolbarProps) {
  const currentPage = useReaderState((s) => s.currentPage);
  const totalPages = useReaderState((s) => s.totalPages);
  const setScrollTargetPage = useReaderState((s) => s.setScrollTargetPage);
  const collapsed = useReaderState((s) => s.toolbarCollapsed);
  const setCollapsed = useReaderState((s) => s.setToolbarCollapsed);

  if (collapsed) {
    return (
      <div
        className="h-2 w-full cursor-pointer border-b bg-muted/40 transition-all hover:h-12 hover:bg-background"
        onMouseEnter={() => setCollapsed(false)}
        aria-label="Expand toolbar"
        role="button"
      />
    );
  }

  return (
    <header className="flex h-12 items-center justify-between border-b bg-background px-4">
      <div className="flex items-center gap-3">
        <Link href="/library">
          <Button variant="ghost" size="sm">Back</Button>
        </Link>
        <span className="max-w-[300px] truncate text-sm font-medium">{title}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setScrollTargetPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1 || totalPages === 0}
          >
            Prev
          </Button>
          <span>{currentPage} / {totalPages || "—"}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setScrollTargetPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages || totalPages === 0}
          >
            Next
          </Button>
        </div>
        <ZoomControls />
        {onToggleSidebar && (
          <Button variant={sidebarOpen ? "secondary" : "ghost"} size="sm" onClick={onToggleSidebar}>
            Highlights
          </Button>
        )}
        {onToggleComments && (
          <Button
            variant={commentsOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={onToggleComments}
          >
            Comments
          </Button>
        )}
        {onToggleChat && (
          <Button
            variant={chatOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={onToggleChat}
          >
            Chat
          </Button>
        )}
        {onToggleOutline && (
          <Button
            variant={outlineOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={onToggleOutline}
          >
            Outline
          </Button>
        )}
        {onToggleCitations && (
          <Button
            variant={citationsOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={onToggleCitations}
          >
            Citations
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse toolbar"
        >
          ⇡
        </Button>
      </div>
    </header>
  );
}
