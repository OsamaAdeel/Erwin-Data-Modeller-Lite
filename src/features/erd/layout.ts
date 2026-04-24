import * as dagre from "@dagrejs/dagre";
import type { ModelEntity } from "@/services/xml/model";
import type { Relationship } from "@/services/xml/relationships";

export interface NodePosition {
  id: string;
  x: number;       // top-left
  y: number;
  width: number;
  height: number;
}

export interface EdgeRoute {
  id: string;
  sourceId: string;
  targetId: string;
  points: Array<{ x: number; y: number }>;
  name: string | null;
}

export interface LayoutResult {
  nodes: Map<string, NodePosition>;
  edges: EdgeRoute[];
  width: number;
  height: number;
}

const ENTITY_WIDTH = 220;
const HEADER_H = 32;
const ROW_H = 18;
const PADDING_Y = 8;

export function entityHeight(columnCount: number): number {
  // header + row per column + a little padding, capped to keep huge tables sane.
  const visible = Math.min(columnCount, 14);
  return HEADER_H + visible * ROW_H + PADDING_Y * 2;
}

export function computeLayout(
  entities: ModelEntity[],
  relationships: Relationship[]
): LayoutResult {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: "LR",
    ranksep: 80,
    nodesep: 40,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const ent of entities) {
    g.setNode(ent.id, {
      width: ENTITY_WIDTH,
      height: entityHeight(ent.columns.length),
    });
  }

  // Build a quick id-set so we can skip dangling edges.
  const nodeIds = new Set(entities.map((e) => e.id));

  for (const rel of relationships) {
    if (!nodeIds.has(rel.parentEntityId) || !nodeIds.has(rel.childEntityId)) continue;
    g.setEdge(rel.parentEntityId, rel.childEntityId, { id: rel.id, name: rel.name }, rel.id);
  }

  dagre.layout(g);

  const nodes = new Map<string, NodePosition>();
  for (const id of g.nodes()) {
    const n = g.node(id);
    if (!n) continue;
    nodes.set(id, {
      id,
      x: n.x - n.width / 2,
      y: n.y - n.height / 2,
      width: n.width,
      height: n.height,
    });
  }

  const edges: EdgeRoute[] = [];
  for (const e of g.edges()) {
    const data = g.edge(e);
    edges.push({
      id: data.id ?? `${e.v}->${e.w}`,
      sourceId: e.v,
      targetId: e.w,
      points: data.points
        ? (data.points as Array<{ x: number; y: number }>).map((p) => ({ x: p.x, y: p.y }))
        : [],
      name: data.name ?? null,
    });
  }

  const graphLabel = g.graph();
  return {
    nodes,
    edges,
    width: graphLabel.width ?? 0,
    height: graphLabel.height ?? 0,
  };
}
