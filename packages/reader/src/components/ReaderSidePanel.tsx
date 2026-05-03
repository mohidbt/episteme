import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export type ReaderSidePanelProps = {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
};

export function ReaderSidePanel({
  isOpen,
  onClose,
  title = "Agent",
  children,
}: ReaderSidePanelProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <aside
      data-reader-side-panel
      className="flex h-full w-[420px] flex-col border-l border-border bg-background"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="rounded-md p-1 hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </aside>
  );
}
