"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";

export interface WikiLinkTypeaheadRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export type WikiLinkPick = {
  title: string;
  targetKind: "note" | "reference" | "paper";
  targetId: string | null;
};

export interface WikiLinkTypeaheadProps {
  query: string;
  onSelect: (payload: WikiLinkPick) => void;
}

interface NoteHit {
  id: string;
  title: string;
  slug: string;
}
interface RefHit {
  id: string;
  title: string;
  citationKey: string;
}
interface PaperHit {
  id: string;
  title: string;
}
interface SearchResponse {
  notes: NoteHit[];
  references: RefHit[];
  papers: PaperHit[];
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

type Item =
  | { kind: "note"; id: string; title: string }
  | { kind: "reference"; id: string; title: string; citationKey: string }
  | { kind: "paper"; id: string; title: string }
  | { kind: "create"; title: string };

export const WikiLinkTypeahead = forwardRef<WikiLinkTypeaheadRef, WikiLinkTypeaheadProps>(
  function WikiLinkTypeahead({ query, onSelect }, ref) {
    const debouncedQuery = useDebouncedQuery(query, SEARCH_DEBOUNCE_MS);
    const [data, setData] = useState<SearchResponse>({
      notes: [],
      references: [],
      papers: [],
    });
    const [selected, setSelected] = useState(0);

    useEffect(() => {
      let cancelled = false;
      const q = debouncedQuery.trim();
      if (q.length === 0) {
        setData({ notes: [], references: [], papers: [] });
        return;
      }
      fetch(`/api/wiki-link/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : { notes: [], references: [], papers: [] }))
        .then((d: SearchResponse) => {
          if (!cancelled) {
            setData({
              notes: d.notes ?? [],
              references: d.references ?? [],
              papers: d.papers ?? [],
            });
          }
        })
        .catch(() => {
          if (!cancelled) setData({ notes: [], references: [], papers: [] });
        });
      return () => {
        cancelled = true;
      };
    }, [debouncedQuery]);

    const items = useMemo<Item[]>(() => {
      const flat: Item[] = [
        ...data.notes.map<Item>((n) => ({ kind: "note", id: n.id, title: n.title })),
        ...data.references.map<Item>((r) => ({
          kind: "reference",
          id: r.id,
          title: r.title,
          citationKey: r.citationKey,
        })),
        ...data.papers.map<Item>((p) => ({
          kind: "paper",
          id: p.id,
          title: p.title,
        })),
      ];
      if (flat.length === 0 && query.trim().length > 0) {
        flat.push({ kind: "create", title: query.trim() });
      }
      return flat;
    }, [data, query]);

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
          title: item.title,
          targetKind: item.kind,
          targetId: item.id,
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
        <div className="z-50 min-w-[260px] rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
          Type to search notes, references, papers…
        </div>
      );
    }

    return (
      <div className="z-50 min-w-[280px] rounded-md border bg-popover p-1 text-sm shadow-md">
        <Section label="Notes" items={items} kind="note" selected={selected} onPick={pick} />
        <Section label="References" items={items} kind="reference" selected={selected} onPick={pick} />
        <Section label="Papers" items={items} kind="paper" selected={selected} onPick={pick} />
        {items.length === 1 && items[0].kind === "create" && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              pick(0);
            }}
            className={`w-full rounded px-2 py-1.5 text-left ${
              selected === 0 ? "bg-accent text-accent-foreground" : ""
            }`}
          >
            Press Enter to create &quot;{items[0].title}&quot;
          </button>
        )}
        {items.length === 0 && (
          <div className="px-2 py-1.5 text-muted-foreground">No results</div>
        )}
      </div>
    );
  },
);

function Section({
  label,
  items,
  kind,
  selected,
  onPick,
}: {
  label: string;
  items: Item[];
  kind: "note" | "reference" | "paper";
  selected: number;
  onPick: (index: number) => void;
}) {
  const entries = items
    .map((it, i) => ({ it, i }))
    .filter((e) => e.it.kind === kind);
  if (entries.length === 0) return null;
  return (
    <div className="mb-1 last:mb-0">
      <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {entries.map(({ it, i }) => {
        if (it.kind === "create") return null;
        const isSelected = i === selected;
        const sub =
          it.kind === "reference" ? it.citationKey : undefined;
        return (
          <button
            key={`${it.kind}:${it.id}`}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(i);
            }}
            className={`w-full rounded px-2 py-1.5 text-left ${
              isSelected ? "bg-accent text-accent-foreground" : ""
            }`}
          >
            <span>{it.title}</span>
            {sub && (
              <span className="ml-2 text-xs text-muted-foreground">{sub}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
