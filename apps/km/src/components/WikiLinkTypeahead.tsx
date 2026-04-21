"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";

export interface WikiLinkSearchResult {
  id: string;
  title: string;
  slug: string;
}

export interface WikiLinkTypeaheadRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export interface WikiLinkTypeaheadProps {
  query: string;
  onSelect: (payload: {
    title: string;
    targetKind: "note";
    targetId: string | null;
  }) => void;
}

const SEARCH_DEBOUNCE_MS = 150;

function useDebouncedQuery(query: string, delay: number): string {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), delay);
    return () => clearTimeout(t);
  }, [query, delay]);
  return debounced;
}

export const WikiLinkTypeahead = forwardRef<WikiLinkTypeaheadRef, WikiLinkTypeaheadProps>(
  function WikiLinkTypeahead({ query, onSelect }, ref) {
    const debouncedQuery = useDebouncedQuery(query, SEARCH_DEBOUNCE_MS);
    const [results, setResults] = useState<WikiLinkSearchResult[]>([]);
    const [selected, setSelected] = useState(0);

    useEffect(() => {
      let cancelled = false;
      const q = debouncedQuery.trim();
      if (q.length === 0) {
        setResults([]);
        return;
      }
      fetch(`/api/notes/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((data: { results: WikiLinkSearchResult[] }) => {
          if (!cancelled) setResults(data.results ?? []);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
      return () => {
        cancelled = true;
      };
    }, [debouncedQuery]);

    // Virtual "create new" entry shown when query is non-empty and has no matches.
    const showCreate = query.trim().length > 0 && results.length === 0;
    const items = useMemo(() => {
      if (showCreate) {
        return [{ kind: "create" as const, title: query.trim() }];
      }
      return results.map((r) => ({ kind: "existing" as const, result: r }));
    }, [results, showCreate, query]);

    useEffect(() => {
      setSelected(0);
    }, [items.length]);

    const pick = (index: number) => {
      const item = items[index];
      if (!item) return;
      if (item.kind === "create") {
        onSelect({ title: item.title, targetKind: "note", targetId: null });
      } else {
        onSelect({
          title: item.result.title,
          targetKind: "note",
          targetId: item.result.id,
        });
      }
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelected((i) => (items.length === 0 ? 0 : (i + items.length - 1) % items.length));
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
          return true;
        }
        if (event.key === "Enter") {
          if (items.length > 0) {
            pick(selected);
            return true;
          }
        }
        return false;
      },
    }));

    if (query.trim().length === 0) {
      return (
        <div className="z-50 min-w-[240px] rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
          Type to search notes…
        </div>
      );
    }

    return (
      <div className="z-50 min-w-[240px] rounded-md border bg-popover p-1 text-sm shadow-md">
        {items.length === 0 ? (
          <div className="px-2 py-1.5 text-muted-foreground">No results</div>
        ) : (
          items.map((item, i) => {
            const isSelected = i === selected;
            const label =
              item.kind === "create"
                ? `Press Enter to create "${item.title}"`
                : item.result.title;
            return (
              <button
                key={item.kind === "create" ? "__create__" : item.result.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
                onMouseEnter={() => setSelected(i)}
                className={`w-full rounded px-2 py-1.5 text-left ${
                  isSelected ? "bg-accent text-accent-foreground" : ""
                }`}
              >
                {label}
              </button>
            );
          })
        )}
      </div>
    );
  },
);
