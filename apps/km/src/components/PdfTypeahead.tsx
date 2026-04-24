"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

export interface PdfTypeaheadRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export interface PdfResult {
  id: string;
  title: string;
  filename: string;
  year: number | null;
  doi: string | null;
}

export interface PdfPick {
  pdfId: string;
  title: string;
  page: number | null;
}

export interface PdfTypeaheadProps {
  query: string;
  onSelect: (payload: PdfPick) => void;
}

const SEARCH_DEBOUNCE_MS = 200;

function useDebouncedQuery(query: string, delay: number): string {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), delay);
    return () => clearTimeout(t);
  }, [query, delay]);
  return debounced;
}

export const PdfTypeahead = forwardRef<PdfTypeaheadRef, PdfTypeaheadProps>(
  function PdfTypeahead({ query, onSelect }, ref) {
    const debouncedQuery = useDebouncedQuery(query, SEARCH_DEBOUNCE_MS);
    const [results, setResults] = useState<PdfResult[]>([]);
    const [selected, setSelected] = useState(0);

    useEffect(() => {
      let cancelled = false;
      const q = debouncedQuery.trim();
      if (q.length === 0) {
        setResults([]);
        return;
      }
      fetch(`/api/pdfs/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((data: { results: PdfResult[] }) => {
          if (!cancelled) setResults(data?.results ?? []);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
      return () => {
        cancelled = true;
      };
    }, [debouncedQuery]);

    useEffect(() => {
      setSelected(0);
    }, [results.length]);

    const pick = (index: number) => {
      const item = results[index];
      if (!item) return;
      onSelect({ pdfId: item.id, title: item.title, page: null });
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelected((i) =>
            results.length === 0 ? 0 : (i + results.length - 1) % results.length,
          );
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
          return true;
        }
        if (event.key === "Enter") {
          if (results.length > 0) {
            pick(selected);
            return true;
          }
        }
        return false;
      },
    }));

    if (query.trim().length === 0) {
      return (
        <div className="z-50 min-w-[260px] rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
          Type to search your PDFs…
        </div>
      );
    }

    if (results.length === 0) {
      return (
        <div className="z-50 min-w-[260px] rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
          No PDFs found for &quot;{query}&quot;
        </div>
      );
    }

    return (
      <div className="z-50 min-w-[320px] rounded-md border bg-popover p-1 text-sm shadow-md">
        {results.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              pick(i);
            }}
            className={`w-full rounded px-2 py-1.5 text-left ${
              i === selected ? "bg-accent text-accent-foreground" : ""
            }`}
          >
            <div className="font-medium truncate">{item.title}</div>
            <div className="text-xs text-muted-foreground">
              {item.filename}
              {item.year ? ` · ${item.year}` : ""}
            </div>
          </button>
        ))}
      </div>
    );
  },
);
