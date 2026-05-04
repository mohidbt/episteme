'use client'

import dynamic from 'next/dynamic'
import type { GraphPayload } from '@/lib/graph/types'

const GraphCanvas = dynamic(() => import('@/components/graph/GraphCanvas.client'), { ssr: false })

export default function GraphView({ payload }: { payload: GraphPayload }) {
  return <GraphCanvas payload={payload} />
}
