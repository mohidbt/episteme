export type NodeKind = "paper" | "note" | "reference";
export type EdgeKind = "paper_is_ref" | "wiki_link" | "shared_tag" | "semantic_sim" | "paper_citation";
export type GraphNode = { id: string; kind: NodeKind; label: string };
export type GraphEdge = {
  src: { kind: NodeKind; id: string };
  dst: { kind: NodeKind; id: string };
  kind: EdgeKind;
  weight: number;
  meta?: Record<string, unknown>;
};
export type GraphPayload = { nodes: GraphNode[]; edges: GraphEdge[] };
