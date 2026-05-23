import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import GraphView from './GraphView.client'
import { getRequiredUserId } from '@/lib/session'
import {
  nodesForUser,
  edgesPaperIsRef,
  edgesWikiLink,
  edgesSharedTag,
  edgesSemanticSim,
  edgesPaperCitations,
} from '@/lib/graph/live-edges'
import { db } from '@episteme/db/client'
import { sql } from 'drizzle-orm'
import { rowsOf } from '@/lib/db/rows'
import type { GraphPayload } from '@/lib/graph/types'
import { formatGraphKindLabel } from '@/lib/graph/labels'

const CAP = Number.parseInt(process.env.GRAPH_PAPER_CAP_V1 ?? '2000', 10)

function extractCount(result: unknown): number {
  const arr = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && 'rows' in result
      ? (result as { rows: unknown[] }).rows
      : []
  const row = arr[0] as { n?: number | string } | undefined
  return Number(row?.n ?? 0)
}

async function load(userId: string): Promise<{ payload: GraphPayload; status: { over: boolean; count: number } }> {
  const [nodes, paperIsRef, wikiLink, sharedTag, semanticSim, paperCitations, countResult] = await Promise.all([
    nodesForUser(userId),
    edgesPaperIsRef(userId),
    edgesWikiLink(userId),
    edgesSharedTag(userId),
    edgesSemanticSim(userId),
    edgesPaperCitations(userId),
    db.execute(sql`SELECT count(*)::int AS n FROM papers WHERE user_id = ${userId}`),
  ])

  const count = extractCount(rowsOf<{ n: number }>(countResult))
  const payload: GraphPayload = {
    nodes,
    edges: [...paperIsRef, ...wikiLink, ...sharedTag, ...semanticSim, ...paperCitations],
  }

  return {
    payload,
    status: { over: count > CAP, count },
  }
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
}

function LineSample({ color, dashed = false }: { color: string; dashed?: boolean }) {
  return (
    <span
      className="inline-block w-5 border-t"
      style={{ borderTopColor: color, borderTopStyle: dashed ? 'dashed' : 'solid' }}
      aria-hidden
    />
  )
}

export default async function GraphPage() {
  const userId = await getRequiredUserId()
  const { payload, status } = await load(userId)

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border bg-background/80 px-6 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Knowledge Graph</h1>
            <p className="text-sm text-muted-foreground">
              {payload.nodes.length} nodes · {payload.edges.length} edges
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Dot color="#3b82f6" />{formatGraphKindLabel("paper")}</span>
              <span className="inline-flex items-center gap-1"><Dot color="#22c55e" />{formatGraphKindLabel("note")}</span>
              <span className="inline-flex items-center gap-1"><Dot color="#f59e0b" />{formatGraphKindLabel("reference")}</span>
              <span className="inline-flex items-center gap-1"><LineSample color="#3b82f6" />{formatGraphKindLabel("paper_is_ref")}</span>
              <span className="inline-flex items-center gap-1"><LineSample color="#22c55e" />{formatGraphKindLabel("wiki_link")}</span>
              <span className="inline-flex items-center gap-1"><LineSample color="#a1a1aa" dashed />{formatGraphKindLabel("shared_tag")}</span>
              <span className="inline-flex items-center gap-1"><LineSample color="#a78bfa" />{formatGraphKindLabel("semantic_sim")}</span>
              <span className="inline-flex items-center gap-1"><LineSample color="#ec4899" />Citation</span>
            </div>
            <p className="text-[10px] text-muted-foreground/70">arrow direction = who cites whom</p>
          </div>
        </div>
      </div>

      {status.over ? (
        <div className="px-6 py-3">
          <Alert className="border-border bg-muted text-foreground">
            <AlertTitle>Graph capped for responsiveness</AlertTitle>
            <AlertDescription>
              Showing first {CAP} papers — {status.count} total in your library
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {payload.nodes.length === 0 ? (
        <div className="grid flex-1 place-items-center px-8 text-center text-sm text-muted-foreground">
          Your graph is empty. Add notes, papers, or references and they&apos;ll appear here connected.
        </div>
      ) : (
        <div className="relative flex-1">
          <GraphView payload={payload} />
        </div>
      )}
    </div>
  )
}
