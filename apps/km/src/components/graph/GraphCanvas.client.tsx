'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ForceGraph2D from 'react-force-graph-2d'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { GraphPayload, EdgeKind, NodeKind } from '@/lib/graph/types'
import { formatGraphKindLabel } from '@/lib/graph/labels'

type CanvasNode = {
  id: string
  kind: NodeKind
  label: string
  slug?: string
  fgId: string
}

// GSD-64: resolve the detail-page route for a node. Returns null when no
// stable route exists (e.g. note without slug — legacy data); callers should
// no-op in that case rather than navigate to "/n/undefined".
function detailHrefFor(node: CanvasNode): string | null {
  if (node.kind === 'paper') return `/p/${node.id}`
  if (node.kind === 'reference') return `/r/${node.id}`
  if (node.kind === 'note') {
    if (!node.slug) return null
    return `/n/${node.slug}`
  }
  return null
}

type CanvasLink = {
  source: string
  target: string
  kind: EdgeKind
  weight?: number
  src: { kind: NodeKind; id: string }
  dst: { kind: NodeKind; id: string }
}

const COLORS: Record<NodeKind, string> = {
  paper: '#3b82f6',
  note: '#22c55e',
  reference: '#f59e0b',
}

const STYLE: Record<EdgeKind, { dash?: number[]; opacity: number; widthMul: number; color: string }> = {
  paper_is_ref: { opacity: 1.0, widthMul: 2.5, color: '#3b82f6' },
  wiki_link: { opacity: 1.0, widthMul: 1.5, color: '#22c55e' },
  shared_tag: { dash: [2, 4], opacity: 0.45, widthMul: 1.0, color: '#a1a1aa' },
  semantic_sim: { opacity: 0.6, widthMul: 0.8, color: '#a78bfa' },
  citing: { opacity: 0.95, widthMul: 1.8, color: '#ec4899' },
}

function edgeKindBadgeClass(kind: EdgeKind): string {
  if (kind === 'paper_is_ref') return 'bg-blue-500/15 text-blue-300 border-blue-400/40'
  if (kind === 'wiki_link') return 'bg-green-500/15 text-green-300 border-green-400/40'
  if (kind === 'shared_tag') return 'bg-zinc-500/15 text-zinc-300 border-zinc-400/40'
  if (kind === 'citing') return 'bg-pink-500/15 text-pink-300 border-pink-400/40'
  return 'bg-violet-500/15 text-violet-300 border-violet-400/40'
}

// Perspective-aware label for a citing edge, computed relative to the
// currently focused/hovered node. With ONE edge per citation row the
// label flips depending on which endpoint the user is looking from.
function citingLabel(
  link: { src: { kind: NodeKind; id: string }; dst: { kind: NodeKind; id: string } },
  focusedKey: string | null,
): 'Citing' | 'Cited in' | 'Citation' {
  if (!focusedKey) return 'Citation'
  const srcKey = `${link.src.kind}:${link.src.id}`
  const dstKey = `${link.dst.kind}:${link.dst.id}`
  if (focusedKey === srcKey) return 'Citing'
  if (focusedKey === dstKey) return 'Cited in'
  return 'Citation'
}

// Delay before treating a single click as a navigation. react-force-graph-2d
// (v1.29.1) has no onNodeDblClick prop, so we implement dblclick inside
// onNodeClick using a timestamp + last-clicked-node ref. The single-click
// path runs on a timer; if a second click on the same node arrives within
// DBLCLICK_WINDOW_MS, the timer is cancelled and we route to /p or /r.
// 500ms matches the OS accessibility standard for double-click thresholds
// (Windows SPI_GETDOUBLECLICKTIME default, WCAG/macOS guidance) — gives users
// with motor impairments enough time between clicks. CLICK_DEBOUNCE_MS must
// be >= DBLCLICK_WINDOW_MS or the single-click route would fire before the
// dblclick window closes, defeating the cancellation path.
const DBLCLICK_WINDOW_MS = 500
const CLICK_DEBOUNCE_MS = DBLCLICK_WINDOW_MS

export default function GraphCanvas({ payload }: { payload: GraphPayload }) {
  const router = useRouter()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastClickTimeRef = useRef<number>(0)
  const lastClickedNodeIdRef = useRef<string | null>(null)
  const [size, setSize] = useState({ width: 900, height: 600 })
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [selectedLink, setSelectedLink] = useState<CanvasLink | null>(null)
  const [semanticDetail, setSemanticDetail] = useState<{ cosine?: number } | null>(null)

  const nodeByKey = useMemo(() => {
    return new Map(payload.nodes.map((n) => [`${n.kind}:${n.id}`, n] as const))
  }, [payload.nodes])

  const degreeMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const edge of payload.edges) {
      const srcKey = `${edge.src.kind}:${edge.src.id}`
      const dstKey = `${edge.dst.kind}:${edge.dst.id}`
      map.set(srcKey, (map.get(srcKey) ?? 0) + 1)
      map.set(dstKey, (map.get(dstKey) ?? 0) + 1)
    }
    return map
  }, [payload.edges])

  const graphData = useMemo(() => {
    const nodes: CanvasNode[] = payload.nodes.map((n) => ({
      ...n,
      slug: n.slug,
      fgId: `${n.kind}:${n.id}`,
    }))
    const links: CanvasLink[] = payload.edges.map((e) => ({
      source: `${e.src.kind}:${e.src.id}`,
      target: `${e.dst.kind}:${e.dst.id}`,
      kind: e.kind,
      weight: e.weight,
      src: e.src,
      dst: e.dst,
    }))
    return { nodes, links }
  }, [payload])

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      setSize({ width: Math.max(320, rect.width), height: Math.max(320, rect.height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  async function handleLinkClick(link: CanvasLink) {
    setSelectedLink(link)
    setOpen(true)
    if (link.kind !== 'semantic_sim') {
      setSemanticDetail(null)
      return
    }

    try {
      const params = new URLSearchParams({
        srcKind: link.src.kind,
        dstKind: link.dst.kind,
        srcId: link.src.id,
        dstId: link.dst.id,
      })
      const res = await fetch(`/api/graph/edge-detail?${params.toString()}`)
      if (!res.ok) {
        setSemanticDetail(null)
        return
      }
      const json = (await res.json()) as { cosine?: number }
      setSemanticDetail(json)
    } catch {
      setSemanticDetail(null)
    }
  }

  const detail = selectedLink
    ? {
        srcLabel: nodeByKey.get(`${selectedLink.src.kind}:${selectedLink.src.id}`)?.label ?? selectedLink.src.id,
        dstLabel: nodeByKey.get(`${selectedLink.dst.kind}:${selectedLink.dst.id}`)?.label ?? selectedLink.dst.id,
      }
    : null

  return (
    <div ref={wrapperRef} className="h-full w-full overflow-hidden rounded-tl-xl bg-background">
      <ForceGraph2D
        graphData={graphData}
        width={size.width}
        height={size.height}
        nodeId="fgId"
        nodeColor={(n: unknown) => COLORS[(n as CanvasNode).kind]}
        nodeVal={(n: unknown) => 1 + (degreeMap.get((n as CanvasNode).fgId) ?? 0) * 0.5}
        nodeLabel={(n: unknown) => (n as CanvasNode).label}
        linkColor={(l: unknown) => STYLE[(l as CanvasLink).kind].color}
        linkDirectionalArrowLength={(l: unknown) => {
          const k = (l as CanvasLink).kind
          return k === 'citing' ? 4 : 0
        }}
        linkDirectionalArrowRelPos={(l: unknown) => {
          const k = (l as CanvasLink).kind
          return k === 'citing' ? 1 : 0
        }}
        linkDirectionalArrowColor={(l: unknown) => STYLE[(l as CanvasLink).kind].color}
        linkLabel={(l: unknown) => {
          const link = l as CanvasLink
          if (link.kind === 'citing') return citingLabel(link, hoveredNodeId)
          return formatGraphKindLabel(link.kind)
        }}
        linkWidth={(l: unknown) => {
          const link = l as CanvasLink
          const weightFactor = link.kind === 'semantic_sim' ? Math.max(0.4, link.weight ?? 1) : 1
          return STYLE[link.kind].widthMul * weightFactor
        }}
        linkLineDash={(l: unknown) => STYLE[(l as CanvasLink).kind].dash ?? []}
        linkCanvasObjectMode={() => 'replace'}
        linkCanvasObject={(linkObj: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const link = linkObj as CanvasLink
          const src = link.source as unknown as { x?: number; y?: number } | string | null | undefined
          const dst = link.target as unknown as { x?: number; y?: number } | string | null | undefined
          if (!src || !dst) return
          if (typeof src === 'string' || typeof dst === 'string') return
          if (typeof src.x !== 'number' || typeof src.y !== 'number') return
          if (typeof dst.x !== 'number' || typeof dst.y !== 'number') return
          const style = STYLE[link.kind]
          ctx.save()
          ctx.globalAlpha = style.opacity
          ctx.strokeStyle = style.color
          ctx.lineWidth = (style.widthMul * (link.kind === 'semantic_sim' ? Math.max(0.4, link.weight ?? 1) : 1)) / Math.sqrt(globalScale)
          ctx.setLineDash(style.dash ?? [])
          ctx.beginPath()
          ctx.moveTo(src.x, src.y)
          ctx.lineTo(dst.x, dst.y)
          ctx.stroke()
          ctx.restore()
        }}
        nodeCanvasObjectMode={(n: unknown) => ((n as CanvasNode).fgId === hoveredNodeId ? 'replace' : undefined)}
        nodeCanvasObject={(nodeObj: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const node = nodeObj as CanvasNode & { x: number; y: number }
          const base = COLORS[node.kind]
          const radius = Math.max(3, (1 + (degreeMap.get(node.fgId) ?? 0) * 0.5) / Math.sqrt(globalScale) + 1.5)
          ctx.save()
          ctx.fillStyle = base
          ctx.beginPath()
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false)
          ctx.fill()
          ctx.strokeStyle = 'rgba(255,255,255,0.85)'
          ctx.lineWidth = 1.5 / Math.sqrt(globalScale)
          ctx.stroke()
          ctx.restore()
        }}
        onNodeHover={(node: unknown) => setHoveredNodeId(node ? (node as CanvasNode).fgId : null)}
        onNodeClick={(node: unknown) => {
          const n = node as CanvasNode
          const now = Date.now()
          const isDblClick =
            lastClickedNodeIdRef.current === n.fgId &&
            now - lastClickTimeRef.current < DBLCLICK_WINDOW_MS
          // GSD-64: a single click on ANY node opens its detail page directly
          // (papers → /p, references → /r, notes → /n/<slug>). The earlier
          // `/graph/<id>` paper-scoped subview branch was removed because it
          // surfaced a different H1 ("paper title" instead of "Knowledge Graph")
          // with no legend, which users perceived as the graph page losing
          // state. Two-click and single-click now resolve to the same detail
          // page; the dblclick path stays in so a fast second tap pre-empts the
          // debounce timer for users who expect Notion-style dblclick-to-open.
          const href = detailHrefFor(n)
          if (isDblClick) {
            if (clickTimerRef.current) {
              clearTimeout(clickTimerRef.current)
              clickTimerRef.current = null
            }
            lastClickTimeRef.current = 0
            lastClickedNodeIdRef.current = null
            if (href) router.push(href)
            return
          }
          lastClickTimeRef.current = now
          lastClickedNodeIdRef.current = n.fgId
          if (!href) return
          if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
          clickTimerRef.current = setTimeout(() => {
            clickTimerRef.current = null
            router.push(href)
          }, CLICK_DEBOUNCE_MS)
        }}
        onLinkClick={(l: unknown) => void handleLinkClick(l as CanvasLink)}
        d3VelocityDecay={0.3}
        d3AlphaDecay={0.02}
        backgroundColor="transparent"
      />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edge detail</SheetTitle>
          </SheetHeader>
          {selectedLink && detail ? (
            <div className="space-y-4 p-4 pt-0 text-sm">
              <Badge variant="outline" className={edgeKindBadgeClass(selectedLink.kind)}>
                {selectedLink.kind === 'citing'
                  ? citingLabel(selectedLink, hoveredNodeId)
                  : formatGraphKindLabel(selectedLink.kind)}
              </Badge>
              {selectedLink.weight != null ? <p className="text-muted-foreground">Weight: {selectedLink.weight}</p> : null}

              {selectedLink.kind === 'semantic_sim' ? (
                <div className="space-y-1">
                  <p>{detail.srcLabel} → {detail.dstLabel}</p>
                  <p className="text-muted-foreground">Cosine similarity: {semanticDetail?.cosine ?? selectedLink.weight ?? 'N/A'}</p>
                </div>
              ) : null}

              {selectedLink.kind === 'wiki_link' ? (
                <p>{detail.srcLabel} → {detail.dstLabel}</p>
              ) : null}

              {selectedLink.kind === 'paper_is_ref' ? (
                <p>{detail.srcLabel} ↔ {detail.dstLabel}</p>
              ) : null}

              {selectedLink.kind === 'citing' ? (
                <p>{detail.srcLabel} cites {detail.dstLabel}</p>
              ) : null}

              {selectedLink.kind === 'shared_tag' ? (
                <div className="space-y-1">
                  <p>{detail.srcLabel} ↔ {detail.dstLabel}</p>
                  <p className="text-muted-foreground">Shared tags: {selectedLink.weight ?? 'N/A'}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
