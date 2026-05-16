"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Direction = "citing" | "cited-in";

interface Edge {
  id: number;
  otherKind: "paper" | "reference";
  otherId: string;
  title: string | null;
  markerIdx: number | null;
}

interface State {
  loading: boolean;
  edges: Edge[];
  error: string | null;
}

const INITIAL: State = { loading: true, edges: [], error: null };

function useEdges(paperId: string, direction: Direction): State {
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, edges: [], error: null });
    fetch(`/api/papers/${paperId}/citations/edges?direction=${direction}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`status_${r.status}`);
        return (await r.json()) as { edges: Edge[] };
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setState({ loading: false, edges: body.edges, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          edges: [],
          error: err instanceof Error ? err.message : "error",
        });
      });
    return () => controller.abort();
  }, [paperId, direction]);

  return state;
}

function EdgeList({
  edges,
  onSelectPaper,
}: {
  edges: Edge[];
  onSelectPaper: (id: string) => void;
}) {
  if (edges.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No citations.</p>;
  }
  return (
    <ul className="flex flex-col">
      {edges.map((e) => {
        const isPaper = e.otherKind === "paper";
        const label = e.title ?? "(untitled)";
        return (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => {
                if (isPaper) onSelectPaper(e.otherId);
              }}
              disabled={!isPaper}
              className="flex w-full flex-col items-start gap-0.5 rounded px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
            >
              <span className="line-clamp-2">{label}</span>
              <span className="text-xs text-muted-foreground">
                {isPaper ? "paper" : "reference"}
                {e.markerIdx != null ? ` · [${e.markerIdx}]` : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function CitationPanel({ paperId }: { paperId: string }) {
  const [direction, setDirection] = useState<Direction>("citing");
  const router = useRouter();
  const state = useEdges(paperId, direction);

  const counts = state.loading ? "…" : state.edges.length;

  return (
    <Tabs
      value={direction}
      onValueChange={(v) => setDirection(v as Direction)}
      className="h-full w-72 border-l border-border bg-background"
    >
      <TabsList className="m-2 w-[calc(100%-1rem)]">
        <TabsTrigger value="cited-in" className="flex-1">
          Cited in ({direction === "cited-in" ? counts : "—"})
        </TabsTrigger>
        <TabsTrigger value="citing" className="flex-1">
          Citing ({direction === "citing" ? counts : "—"})
        </TabsTrigger>
      </TabsList>
      <TabsContent value="citing" className="overflow-y-auto">
        {state.error ? (
          <p className="px-3 py-2 text-xs text-destructive">Failed to load.</p>
        ) : (
          <EdgeList
            edges={state.edges}
            onSelectPaper={(id) => router.push(`/graph/${id}`)}
          />
        )}
      </TabsContent>
      <TabsContent value="cited-in" className="overflow-y-auto">
        {state.error ? (
          <p className="px-3 py-2 text-xs text-destructive">Failed to load.</p>
        ) : (
          <EdgeList
            edges={state.edges}
            onSelectPaper={(id) => router.push(`/graph/${id}`)}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
