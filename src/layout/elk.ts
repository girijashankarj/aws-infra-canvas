/**
 * Hierarchical graph layout via ELK.
 *
 * ELK is used rather than dagre because AWS diagrams are naturally nested —
 * a VPC contains subnets, a subnet contains instances — and ELK lays out
 * compound nodes with `INCLUDE_CHILDREN`, keeping edges sensible across
 * container boundaries.
 *
 * Runs in a Web Worker so a large template does not freeze the editor; falls
 * back to the main thread if the worker cannot be constructed.
 */

import type { ElkNode } from 'elkjs';

import type { Edge, ResourceNode, XY } from '../model/types';
import { lookupCanonical } from '../model/registry';

export const NODE_W = 168;
export const NODE_H = 78;
/** Space reserved at the top of a container for its title. */
export const GROUP_HEADER = 34;

interface ElkLike {
  layout(graph: ElkNode): Promise<ElkNode>;
}

let elkPromise: Promise<ElkLike> | null = null;

async function getElk(): Promise<ElkLike> {
  if (!elkPromise) {
    elkPromise = (async () => {
      try {
        const [{ default: ELK }, { default: Worker }] = await Promise.all([
          import('elkjs/lib/elk-api.js'),
          import('elkjs/lib/elk-worker.min.js?worker'),
        ]);
        return new ELK({ workerFactory: () => new Worker() }) as unknown as ElkLike;
      } catch {
        const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
        return new ELK() as unknown as ElkLike;
      }
    })();
  }
  return elkPromise;
}

const BASE_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
  'elk.spacing.nodeNode': '44',
  'elk.spacing.edgeNode': '28',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
};

const GROUP_OPTIONS: Record<string, string> = {
  'elk.padding': `[top=${GROUP_HEADER + 16},left=22,bottom=22,right=22]`,
};

const isContainer = (node: ResourceNode, hasChildren: boolean): boolean =>
  hasChildren && (lookupCanonical(node.canonicalType)?.container ?? false);

/** Builds the ELK tree, nesting each node under its containment parent. */
function toElkTree(nodes: ResourceNode[], edges: Edge[]): ElkNode {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childIds = new Map<string, string[]>();

  for (const n of nodes) {
    // A parent that is not itself in the graph cannot host children.
    const parent = n.parentId && byId.has(n.parentId) ? n.parentId : undefined;
    if (parent) {
      const list = childIds.get(parent) ?? [];
      list.push(n.id);
      childIds.set(parent, list);
    }
  }

  const build = (node: ResourceNode): ElkNode => {
    const kids = childIds.get(node.id) ?? [];
    if (!isContainer(node, kids.length > 0)) {
      return { id: node.id, width: NODE_W, height: NODE_H };
    }
    return {
      id: node.id,
      layoutOptions: GROUP_OPTIONS,
      children: kids.map((id) => build(byId.get(id)!)),
    };
  };

  const roots = nodes.filter((n) => {
    const parent = n.parentId && byId.has(n.parentId) ? n.parentId : undefined;
    if (!parent) return true;
    // If the declared parent is not rendered as a container, treat as a root.
    return !isContainer(byId.get(parent)!, true);
  });

  return {
    id: 'root',
    layoutOptions: BASE_OPTIONS,
    children: roots.map(build),
    edges: edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  };
}

export interface LayoutResult {
  /** Position relative to the containment parent, matching React Flow. */
  positions: Record<string, XY>;
  /** Computed size for container nodes. */
  sizes: Record<string, { width: number; height: number }>;
}

/** Runs a full automatic layout, discarding any previous arrangement. */
export async function autoLayout(nodes: ResourceNode[], edges: Edge[]): Promise<LayoutResult> {
  if (nodes.length === 0) return { positions: {}, sizes: {} };

  const elk = await getElk();
  const laid = await elk.layout(toElkTree(nodes, edges));

  const positions: Record<string, XY> = {};
  const sizes: Record<string, { width: number; height: number }> = {};

  const walk = (node: ElkNode) => {
    for (const child of node.children ?? []) {
      positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
      if (child.children?.length) {
        sizes[child.id] = { width: child.width ?? NODE_W, height: child.height ?? NODE_H };
      }
      walk(child);
    }
  };
  walk(laid);

  return { positions, sizes };
}

/**
 * Places nodes that have no stored position without disturbing the ones that
 * do, so adding a resource never reshuffles an arrangement the user made.
 */
export function placeNewNodes(
  nodes: ResourceNode[],
  known: Record<string, XY>,
): Record<string, XY> {
  const missing = nodes.filter((n) => !known[n.id]);
  if (missing.length === 0) return known;

  const placed = Object.values(known);
  const right = placed.length ? Math.max(...placed.map((p) => p.x)) + NODE_W + 80 : 0;
  const top = placed.length ? Math.min(...placed.map((p) => p.y)) : 0;

  const next = { ...known };
  missing.forEach((node, i) => {
    // Children are positioned relative to their parent, so start them inside it.
    const nested = node.parentId && known[node.parentId] !== undefined;
    next[node.id] = nested
      ? { x: 24, y: GROUP_HEADER + 16 + i * (NODE_H + 20) }
      : { x: right, y: top + i * (NODE_H + 28) };
  });
  return next;
}
