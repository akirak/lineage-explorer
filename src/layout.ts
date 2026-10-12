import dagre from '@dagrejs/dagre';
import type { XYPosition } from '@xyflow/react';

export const NODE_W = 236;
export const NODE_H = 58;

export const TABLE_W = 260;
export const TABLE_HEADER_H = 50;
export const TABLE_ROW_H = 26;

export const tableHeight = (rows: number) => TABLE_HEADER_H + Math.max(rows, 1) * TABLE_ROW_H + 6;

type Size = { width: number; height: number };

export function layoutNodes<N extends { id: string }>(
  nodes: N[],
  edges: { source: string; target: string }[],
  size: (n: N) => Size = () => ({ width: NODE_W, height: NODE_H }),
): (N & { position: XYPosition })[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 26, ranksep: 96, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, size(n)));
  edges.forEach((e) => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  });
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - p.width / 2, y: p.y - p.height / 2 } };
  });
}

export function traverse(startIds: Iterable<string>, adjacency: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [...startIds];
  while (stack.length) {
    const id = stack.pop()!;
    for (const next of adjacency.get(id) || []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

export function adjacency(edges: { source: string; target: string }[]) {
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const e of edges) {
    if (!up.has(e.target)) up.set(e.target, []);
    up.get(e.target)!.push(e.source);
    if (!down.has(e.source)) down.set(e.source, []);
    down.get(e.source)!.push(e.target);
  }
  return { up, down };
}
