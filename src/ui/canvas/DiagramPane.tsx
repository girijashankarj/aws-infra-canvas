/**
 * The right pane. Renders the model and turns every interaction into a
 * `ModelOp`, which the store applies to the source text.
 *
 * Nothing here mutates the model directly — the diagram you see is always the
 * result of re-parsing the text after an edit landed.
 */

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge as RFEdge,
  type FitViewOptions,
  type Node as RFNode,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CATEGORY_COLORS, lookupCanonical } from '../../model/registry';
import type { ModelOp, XY } from '../../model/types';
import { useStore } from '../../state/store';
import { findingsByNode, worstSeverity } from '../../wellarchitected/review';
import { GROUP_HEADER, NODE_H, NODE_W } from '../../layout/elk';
import { GroupNodeView, type GroupFlowNode } from './nodes/GroupNodeView';
import { ResourceNodeView, type ResourceFlowNode } from './nodes/ResourceNodeView';
import { ConnectDialog, type PendingConnection } from './ConnectDialog';
import { Palette } from './Palette';
import { Inspector } from './Inspector';
import { parsePropPath, uniqueId } from './suggest';

const nodeTypes = { resource: ResourceNodeView, group: GroupNodeView };
type FlowNode = ResourceFlowNode | GroupFlowNode;

function DiagramInner({ dark }: { dark: boolean }) {
  const model = useStore((s) => s.model);
  const positions = useStore((s) => s.positions);
  const sizes = useStore((s) => s.sizes);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const moveNodes = useStore((s) => s.moveNodes);
  const applyOps = useStore((s) => s.applyOps);

  const fitToken = useStore((s) => s.fitToken);
  const review = useStore((s) => s.review);
  const reviewOpen = useStore((s) => s.reviewOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [pending, setPending] = useState<PendingConnection | null>(null);

  // Leave room for the palette so auto-fitted content is never hidden under it.
  const fitOptions = useMemo(
    () =>
      ({
        padding: { top: '28px', right: '48px', bottom: '28px', left: '200px' },
        maxZoom: 1.1,
      }) satisfies FitViewOptions,
    [],
  );

  /**
   * Auto-fitting stops as soon as the user pans or zooms; from then on the
   * viewport is theirs until the next file load or explicit layout.
   */
  const userMovedRef = useRef(false);

  // Layout resolves after the first render, so React Flow's own `fitView` sees
  // an unlaid-out graph. Re-fit once the positions land, and again whenever the
  // canvas is resized — dragging the splitter would otherwise leave the
  // diagram at a size chosen for the old pane width.
  useEffect(() => {
    if (fitToken === 0) return;
    userMovedRef.current = false;

    let frame = 0;
    const refit = (duration: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void fitView({ ...fitOptions, duration }));
    };

    refit(220);

    const container = containerRef.current;
    if (!container) return () => cancelAnimationFrame(frame);

    let debounce: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (userMovedRef.current) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => refit(0), 80);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      clearTimeout(debounce);
      cancelAnimationFrame(frame);
    };
  }, [fitToken, fitView, fitOptions]);

  /** Ids that actually host children, and so render as containers. */
  const containerIds = useMemo(() => {
    const present = new Set(model.nodes.map((n) => n.id));
    const withChildren = new Set(
      model.nodes.map((n) => n.parentId).filter((id): id is string => !!id && present.has(id)),
    );
    return new Set(
      [...withChildren].filter((id) => {
        const node = model.nodes.find((n) => n.id === id)!;
        return lookupCanonical(node.canonicalType)?.container ?? false;
      }),
    );
  }, [model.nodes]);

  // Badges only appear while the review panel is open, so the canvas stays
  // uncluttered when someone is just drawing.
  const findingIndex = useMemo(
    () => (reviewOpen ? findingsByNode(review) : new Map()),
    [review, reviewOpen],
  );

  const rfNodes = useMemo<FlowNode[]>(() => {
    const nodes = model.nodes.map((node): FlowNode => {
      const isGroup = containerIds.has(node.id);
      const parentId = node.parentId && containerIds.has(node.parentId) ? node.parentId : undefined;
      const size = sizes[node.id];

      const base = {
        id: node.id,
        position: positions[node.id] ?? { x: 0, y: 0 },
        // The node array is derived fresh from the model on every render, so
        // React Flow's measured size never survives on these objects. Declaring
        // the size we already know keeps the minimap and fitView accurate.
        initialWidth: isGroup ? (size?.width ?? NODE_W * 2) : NODE_W,
        initialHeight: isGroup ? (size?.height ?? NODE_H * 2 + GROUP_HEADER) : NODE_H,
        selected: node.id === selectedId,
        parentId,
        extent: parentId ? ('parent' as const) : undefined,
        data: {
          label: node.label,
          canonicalType: node.canonicalType,
          rawType: node.rawType,
          readOnly: node.readOnly,
          findings: findingIndex.get(node.id)?.length ?? 0,
          worst: worstSeverity(findingIndex.get(node.id) ?? []),
        },
      };

      if (isGroup) {
        return {
          ...base,
          type: 'group' as const,
          style: {
            width: size?.width ?? NODE_W * 2,
            height: size?.height ?? NODE_H * 2 + GROUP_HEADER,
          },
          // Containers must paint behind their children.
          zIndex: 0,
        };
      }
      return { ...base, type: 'resource' as const, zIndex: 1 };
    });

    // React Flow requires a parent to appear before its children.
    const order = new Map(nodes.map((n, i) => [n.id, i]));
    const depth = (n: FlowNode): number => {
      let d = 0;
      let cur = n.parentId;
      while (cur && order.has(cur) && d < 10) {
        d++;
        cur = nodes[order.get(cur)!].parentId;
      }
      return d;
    };
    return [...nodes].sort((a, b) => depth(a) - depth(b));
  }, [model.nodes, positions, sizes, selectedId, containerIds, findingIndex]);

  const rfEdges = useMemo<RFEdge[]>(() => {
    const touching = (e: { from: string; to: string }) =>
      selectedId !== null && (e.from === selectedId || e.to === selectedId);
    const anySelected = selectedId !== null;

    return model.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      // Full property paths get long; the last segment carries the meaning.
      label: edge.kind === 'depends' ? undefined : edge.label?.split('.').at(-1),
      className: `kind-${edge.kind}${anySelected ? (touching(edge) ? ' hot' : ' dim') : ''}`,
      markerEnd: { type: 'arrowclosed' as const, width: 14, height: 14 },
      labelShowBg: true,
    }));
  }, [model.edges, selectedId]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const moved: Record<string, XY> = {};
      const removed: ModelOp[] = [];
      for (const change of changes) {
        if (change.type === 'position' && change.position) moved[change.id] = change.position;
        if (change.type === 'remove') removed.push({ op: 'deleteResource', id: change.id });
      }
      if (Object.keys(moved).length) moveNodes(moved, false);
      if (removed.length) applyOps(removed);
    },
    [moveNodes, applyOps],
  );

  // Positions are committed to the document only once a drag ends, and only if
  // the node actually moved: React Flow treats a plain click as a zero-distance
  // drag, and merely selecting a resource must not modify the file.
  const dragOriginRef = useRef<XY | null>(null);

  const onNodeDragStart = useCallback<OnNodeDrag<FlowNode>>((_event, node) => {
    dragOriginRef.current = { ...node.position };
  }, []);

  const onNodeDragStop = useCallback<OnNodeDrag<FlowNode>>(
    (_event, node) => {
      const origin = dragOriginRef.current;
      dragOriginRef.current = null;
      if (origin && origin.x === node.position.x && origin.y === node.position.y) return;
      moveNodes({}, true);
    },
    [moveNodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const from = model.nodes.find((n) => n.id === connection.source);
      const to = model.nodes.find((n) => n.id === connection.target);
      if (!from || !to || from.id === to.id) return;
      if (from.readOnly) return;
      setPending({ from, to });
    },
    [model.nodes],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const canonical = event.dataTransfer.getData('application/x-aws-service');
      if (!canonical) return;
      const def = lookupCanonical(canonical);
      if (!def?.cfn) return;

      const taken = new Set(model.nodes.map((n) => n.id));
      const id = uniqueId(def.name.replace(/\s+/g, ''), taken);
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      // Seed the position first: the store keeps known positions across the
      // re-parse, so the node appears exactly where it was dropped.
      moveNodes({ [id]: { x: position.x - NODE_W / 2, y: position.y - NODE_H / 2 } }, false);
      applyOps([{ op: 'addResource', id, rawType: def.cfn, props: def.defaults ?? {} }]);
      select(id, { reveal: true });
    },
    [model.nodes, screenToFlowPosition, moveNodes, applyOps, select],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const confirmConnection = useCallback(
    (path: string) => {
      if (!pending) return;
      const parsed = parsePropPath(path);
      if (parsed.length) {
        applyOps([
          { op: 'addRef', fromId: pending.from.id, toId: pending.to.id, path: parsed },
        ]);
      }
      setPending(null);
    },
    [pending, applyOps],
  );

  const minimapColor = useCallback((node: RFNode) => {
    const canonical = (node.data as { canonicalType?: string }).canonicalType;
    const def = canonical ? lookupCanonical(canonical) : undefined;
    return def ? CATEGORY_COLORS[def.category] : 'var(--edge)';
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={(_, node) => select(node.id, { reveal: true })}
        onPaneClick={() => select(null)}
        // `event` is null for programmatic moves; only real gestures count.
        onMoveStart={(event) => {
          if (event) userMovedRef.current = true;
        }}
        colorMode={dark ? 'dark' : 'light'}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={fitOptions}
        minZoom={0.12}
        deleteKeyCode={['Backspace', 'Delete']}
        nodesConnectable
        elevateEdgesOnSelect
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--canvas-dot)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={minimapColor} maskColor="rgba(0,0,0,0.12)" />
      </ReactFlow>

      <Palette />
      <Inspector />
      {pending && (
        <ConnectDialog
          pending={pending}
          onConfirm={confirmConnection}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

export function DiagramPane({ dark }: { dark: boolean }) {
  return (
    <ReactFlowProvider>
      <DiagramInner dark={dark} />
    </ReactFlowProvider>
  );
}
