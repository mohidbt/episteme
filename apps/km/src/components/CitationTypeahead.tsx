"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";

export interface CitationTypeaheadRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export interface CitationResult {
  id: number;
  citekey: string;
  title: string;
  authors: Array<{ name: string; authorId?: string }>;
  year: string | null;
  doi: string | null;
}

export interface CitationPick {
  citekey: string;
  title: string;
  authors: string[];
  year: string | null;
}

export interface CitationTypeaheadProps {
  query: string;
  onSelect: (payload: CitationPick) => void;
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

export const CitationTypeahead = forwardRef<CitationTypeaheadRef, CitationTypeaheadProps>(
  function CitationTypeahead({ query, onSelect }, ref) {
    const debouncedQuery = useDebouncedQuery(query, SEARCH_DEBOUNCE_MS);
    const [results, setResults] = useState<CitationResult[]>([]);
    const [selected, setSelected] = useState(0);

    useEffect(() => {
      let cancelled = false;
      const q = debouncedQuery.trim();
      if (q.length === 0) {
        setResults([]);
        return;
      }
      fetch(`/api/citations/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data: CitationResult[]) => {
          if (!cancelled) setResults(data ?? []);
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
      onSelect({
        citekey: item.citekey,
        title: item.title,
        authors: item.authors.map((a) => a.name),
        year: item.year,
      });
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

    const authorsLine = useMemo(() => {
      return (ref: CitationResult) =>
        ref.authors
          .slice(0, 3)
          .map((a) => a.name.split(",")[0])
          .join(", ") + (ref.authors.length > 3 ? " et al." : "");
    }, []);

    if (query.trim().length === 0) {
      return (
        <div className="z-50 min-w-[260px] rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
          Type to search your library…
        </div>
      );
    }

    if (results.length === 0) {
      return (
        <div className="z-50 min-w-[260px] rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
          No citations found for &quot;{query}&quot;
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
              {authorsLine(item)}
              {item.year ? ` (${item.year})` : ""}
              <span className="ml-2 opacity-60">[{item.citekey}]</span>
            </div>
          </button>
        ))}
      </div>
    );
  },
);
