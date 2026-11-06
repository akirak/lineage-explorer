import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Panel,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, LocateFixed, Pin, PinOff } from 'lucide-react';
import type { ColumnEdge, Crud, DatasetField, DatasetNode, Graph, LineageEdge, LineageNode } from '../shared/types.ts';
import type { ExplorerSearch, LineageDegree, LineageDirection, Mode } from './search.ts';
import { useGraph } from './useGraph.ts';
import { adjacency, layoutNodes, tableHeight, traverse, NODE_W, NODE_H, TABLE_W } from './layout.ts';
import { inHandle, nodeTypes, outHandle, type LineageFlowNode, type Role, type TableFlowNode } from './nodes.tsx';
import NamespacePicker from './NamespacePicker.tsx';

const EDGE_IDLE = '#9aa6a9';
const EDGE_ACTIVE = '#0d6b62';
const EDGE_VIEW = '#8b6bb8';
const EDGE_VIEW_ACTIVE = '#5b3d8f';

// Output edges carry the job_output.crud marker: create, update, or delete.
const EDGE_CRUD: Record<Crud, { idle: string; active: string }> = {
  C: { idle: '#2e7d4f', active: '#1d5c37' },
  U: { idle: '#b7791f', active: '#8a5a12' },
  D: { idle: '#b3382c', active: '#7f241b' },
};
const CRUD_LABEL: Record<Crud, string> = { C: 'Create', U: 'Update', D: 'Delete' };
const CRUD_LEGEND: Crud[] = ['C', 'U', 'D'];

const DIRECTION_OPTIONS: { value: LineageDirection; label: string; title: string }[] = [
  { value: 'all', label: 'All', title: 'Upstream and downstream nodes' },
  { value: 'downstream', label: 'Downstream', title: 'Downstream only' },
  { value: 'upstream', label: 'Upstream', title: 'Upstream only' },
];

const colKey = (datasetId: string, field: string) => `${datasetId}\u0001${field}`;
const splitColKey = (key: string) => {
  const i = key.lastIndexOf('\u0001');
  return i < 0 ? null : { datasetId: key.slice(0, i), field: key.slice(i + 1) };
};

const transformationLabel = (e: ColumnEdge) =>
  [e.transformationType, e.transformationSubtype].filter(Boolean).join(' · ') || 'Unknown transformation';

const isIndirect = (e: ColumnEdge) => e.transformationType?.toUpperCase() === 'INDIRECT';

type SearchMatch = { id: string; kind: 'job' | 'dataset' | 'column'; name: string; context: string };

type Selection =
  | { kind: 'node'; node: LineageNode }
  | { kind: 'column'; dataset: DatasetNode; field: DatasetField };

function edgeStyle(
  active: boolean,
  hasSelection: boolean,
  dashed = false,
  view = false,
  crud: Crud | null = null,
) {
  const color = view
    ? active
      ? EDGE_VIEW_ACTIVE
      : EDGE_VIEW
    : crud
      ? EDGE_CRUD[crud][active ? 'active' : 'idle']
      : active
        ? EDGE_ACTIVE
        : EDGE_IDLE;
  return {
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    style: {
      stroke: color,
      strokeWidth: active ? 2 : 1.25,
      strokeDasharray: dashed || view ? '5 4' : undefined,
      opacity: hasSelection && !active ? 0.18 : 1,
    },
  };
}

function Explorer() {
  const { setCenter, fitView } = useReactFlow();
  const { mode, namespaces, degree, direction, selected, pinned, isolate } = useSearch({ from: '/' });
  const navigate = useNavigate({ from: '/' });
  const pendingCenter = useRef<string | null>(null);
  const { graph, error, loading, reload } = useGraph();

  // Re-run the queries against the Quack server; in dev the rebuild-db
  // plugin re-points it at the newest parquet build after every rebuild.
  const refreshDatabase = useCallback(async () => {
    await reload();
  }, [reload]);
  const [query, setQuery] = useState('');
  const selectedId = selected || null;

  const updateSearch = useCallback(
    (patch: Partial<ExplorerSearch> | ((prev: ExplorerSearch) => Partial<ExplorerSearch>)) =>
      navigate({
        search: (prev) => {
          const current = prev as ExplorerSearch;
          return { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
        },
      }),
    [navigate],
  );

  const select = useCallback((id: string | null) => updateSearch({ selected: id ?? '' }), [updateSearch]);

  const setMode = (next: Mode) => {
    if (next === mode) return;
    updateSearch((prev) => {
      let selected = prev.selected;
      // A selected column maps to its dataset in table mode; a selected job has no counterpart in column mode.
      if (next === 'table') {
        const col = splitColKey(selected);
        if (col) selected = col.datasetId;
      } else if (selected.startsWith('job:')) {
        selected = '';
      }
      return { mode: next, selected };
    });
  };

  const availableNamespaces = useMemo(
    () => (graph ? [...new Set(graph.nodes.map((n) => n.namespace))].sort() : []),
    [graph],
  );

  const scoped = useMemo<Graph>(() => {
    if (!graph) return { nodes: [], edges: [], columnEdges: [] };
    if (namespaces.length === 0) return graph;
    const wanted = new Set(namespaces);
    const nodes = graph.nodes.filter((n) => wanted.has(n.namespace));
    const ids = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
      columnEdges: graph.columnEdges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    };
  }, [graph, namespaces]);

  const nodeById = useMemo(() => new Map(scoped.nodes.map((n) => [n.id, n])), [scoped]);
  const datasets = useMemo(() => scoped.nodes.filter((n): n is DatasetNode => n.type === 'dataset'), [scoped]);

  // The pinned card is independent of the namespace filter, so look the node up
  // in the full graph and let the card reveal it if it is currently hidden.
  const pinnedNode = useMemo(
    () => (pinned && graph ? graph.nodes.find((n) => n.id === pinned) ?? null : null),
    [pinned, graph],
  );

  // ---- Table lineage -------------------------------------------------------

  const tableAdj = useMemo(() => adjacency(scoped.edges), [scoped]);

  // ---- Column lineage ------------------------------------------------------

  const colLinks = useMemo(
    () =>
      scoped.columnEdges.map((e) => ({
        edge: e,
        source: colKey(e.source, e.sourceField),
        target: colKey(e.target, e.targetField),
      })),
    [scoped],
  );
  const columnAdj = useMemo(() => adjacency(colLinks), [colLinks]);

  // Dataset-to-dataset edges used to lay out column mode: column edges plus job hops.
  const datasetLinks = useMemo(() => {
    const links = new Map<string, { source: string; target: string }>();
    const add = (source: string, target: string) => links.set(`${source}->${target}`, { source, target });
    scoped.columnEdges.forEach((e) => add(e.source, e.target));
    scoped.edges.filter((e) => e.kind === 'view').forEach((e) => add(e.source, e.target));
    for (const n of scoped.nodes) {
      if (n.type !== 'job') continue;
      for (const i of tableAdj.up.get(n.id) || []) for (const o of tableAdj.down.get(n.id) || []) add(i, o);
    }
    return [...links.values()];
  }, [scoped, tableAdj]);

  // ---- Selection -----------------------------------------------------------

  const selection = useMemo<Selection | null>(() => {
    if (!selectedId) return null;
    const node = nodeById.get(selectedId);
    if (node) return mode === 'column' && node.type === 'job' ? null : { kind: 'node', node };
    if (mode !== 'column') return null;
    const col = splitColKey(selectedId);
    const dataset = col && nodeById.get(col.datasetId);
    const field = dataset?.type === 'dataset' ? dataset.fields.find((f) => f.name === col!.field) : undefined;
    return dataset?.type === 'dataset' && field ? { kind: 'column', dataset, field } : null;
  }, [selectedId, nodeById, mode]);

  const hasSelection = selection !== null;

  // Seeds are the ids traversal starts from: the node itself in table mode, or columns in column mode.
  const seeds = useMemo<string[]>(() => {
    if (!selection) return [];
    if (mode === 'table') return [selection.kind === 'node' ? selection.node.id : selection.dataset.id];
    if (selection.kind === 'column') return [colKey(selection.dataset.id, selection.field.name)];
    const ds = selection.node as DatasetNode;
    return ds.fields.map((f) => colKey(ds.id, f.name));
  }, [selection, mode]);

  const degreeLimit = degree === 'all' ? null : Number(degree);

  const { upstream, downstream } = useMemo(() => {
    const adj = mode === 'table' ? tableAdj : columnAdj;
    return { upstream: traverse(seeds, adj.up), downstream: traverse(seeds, adj.down) };
  }, [mode, tableAdj, columnAdj, seeds]);

  const lineage = useMemo(() => new Set([...seeds, ...upstream, ...downstream]), [seeds, upstream, downstream]);

  // The degree filter is measured from the pinned node, not the current selection.
  const pinnedSeeds = useMemo<string[]>(() => {
    if (!pinnedNode || !nodeById.has(pinnedNode.id)) return [];
    if (mode === 'table') return [pinnedNode.id];
    if (pinnedNode.type === 'dataset') {
      return pinnedNode.fields.map((f) => colKey(pinnedNode.id, f.name));
    }
    // Jobs are not drawn in column mode; start from the columns the job
    // touches, falling back to the fields of its directly connected datasets.
    const touched = scoped.columnEdges.filter((e) => e.job === pinnedNode.id);
    if (touched.length > 0) {
      return [
        ...new Set(
          touched.flatMap((e) => [colKey(e.source, e.sourceField), colKey(e.target, e.targetField)]),
        ),
      ];
    }
    const connected = new Set([
      ...(tableAdj.up.get(pinnedNode.id) || []),
      ...(tableAdj.down.get(pinnedNode.id) || []),
    ]);
    return datasets
      .filter((d) => connected.has(d.id))
      .flatMap((d) => d.fields.map((f) => colKey(d.id, f.name)));
  }, [pinnedNode, nodeById, mode, scoped.columnEdges, tableAdj, datasets]);

  const pinnedLineage = useMemo<Set<string> | null>(() => {
    // A direction filter limits the graph even when the degree limit is off.
    if ((degreeLimit === null && direction === 'all') || pinnedSeeds.length === 0) return null;
    const adj = mode === 'table' ? tableAdj : columnAdj;
    // Job seeds are already one hop away from the pinned job.
    const depth =
      degreeLimit === null
        ? Infinity
        : mode === 'column' && pinnedNode?.type === 'job'
          ? Math.max(0, degreeLimit - 1)
          : degreeLimit;
    return new Set([
      ...pinnedSeeds,
      ...(direction !== 'downstream' ? traverse(pinnedSeeds, adj.up, depth) : []),
      ...(direction !== 'upstream' ? traverse(pinnedSeeds, adj.down, depth) : []),
    ]);
  }, [pinnedSeeds, pinnedNode, mode, tableAdj, columnAdj, degreeLimit, direction]);

  const roleOf = useCallback(
    (id: string): Role => {
      if (!hasSelection) return 'none';
      if (seeds.includes(id)) return 'selected';
      if (upstream.has(id)) return 'up';
      if (downstream.has(id)) return 'down';
      return 'none';
    },
    [hasSelection, seeds, upstream, downstream],
  );

  const selectedDatasetId =
    selection?.kind === 'column' ? selection.dataset.id : selection?.kind === 'node' ? selection.node.id : null;

  // ---- Visible graph -------------------------------------------------------

  const isolating = isolate && hasSelection;
  const filtering = isolating || pinnedLineage !== null;
  const visibleLineage = isolating ? lineage : pinnedLineage;
  const visibleDatasetId = isolating
    ? selectedDatasetId
    : pinnedNode?.type === 'dataset'
      ? pinnedNode.id
      : null;

  const tableVisible = useMemo(() => {
    if (!filtering || !visibleLineage) return { nodes: scoped.nodes, edges: scoped.edges };
    return {
      nodes: scoped.nodes.filter((n) => visibleLineage.has(n.id)),
      edges: scoped.edges.filter((e) => visibleLineage.has(e.source) && visibleLineage.has(e.target)),
    };
  }, [scoped, filtering, visibleLineage]);

  const columnVisible = useMemo(() => {
    if (!filtering || !visibleLineage) return { datasets, links: colLinks };
    // Keep only datasets on the lineage, and only their lineage columns.
    const kept = datasets
      .map((d) => ({ ...d, fields: d.fields.filter((f) => visibleLineage.has(colKey(d.id, f.name))) }))
      .filter((d) => d.id === visibleDatasetId || d.fields.length > 0);
    return {
      datasets: kept,
      links: colLinks.filter((l) => visibleLineage.has(l.source) && visibleLineage.has(l.target)),
    };
  }, [datasets, colLinks, filtering, visibleLineage, visibleDatasetId]);

  const positioned = useMemo<Node[]>(() => {
    if (mode === 'table') {
      return layoutNodes(
        tableVisible.nodes.map((n) => ({ id: n.id, type: n.type, data: { ...n } }) as LineageFlowNode),
        tableVisible.edges,
      );
    }
    return layoutNodes(
      columnVisible.datasets.map(
        (d) => ({ id: d.id, type: 'table', data: { ...d, fieldRoles: {} } }) as TableFlowNode,
      ),
      datasetLinks,
      (n) => ({ width: TABLE_W, height: tableHeight(n.data.fields.length) }),
    );
  }, [mode, tableVisible, columnVisible, datasetLinks]);

  const centerOn = useCallback(
    (id: string) => {
      const nodeId = splitColKey(id)?.datasetId ?? id;
      const n = positioned.find((p) => p.id === nodeId);
      if (!n) return;
      const [w, h] =
        n.type === 'table' ? [TABLE_W, tableHeight((n.data as TableFlowNode['data']).fields.length)] : [NODE_W, NODE_H];
      setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: 1, duration: 400 });
    },
    [positioned, setCenter],
  );

  // Center after the graph has re-laid out, e.g. when focusNode switches lineage mode.
  useEffect(() => {
    const id = pendingCenter.current;
    if (!id) return;
    pendingCenter.current = null;
    centerOn(id);
  }, [selectedId, centerOn]);

  const rfNodes = useMemo<Node[]>(
    () =>
      positioned.map((n) => {
        if (mode === 'table') {
          const role = roleOf(n.id);
          return { ...n, data: { ...n.data, role, dim: hasSelection && role === 'none', pinned: pinned === n.id } };
        }
        const d = n.data as TableFlowNode['data'];
        const fieldRoles: Record<string, Role> = {};
        let up = false;
        let down = false;
        for (const f of d.fields) {
          const r = roleOf(colKey(n.id, f.name));
          fieldRoles[f.name] = r;
          up ||= r === 'up';
          down ||= r === 'down';
        }
        const role: Role = n.id === selectedDatasetId ? 'selected' : up ? 'up' : down ? 'down' : 'none';
        return { ...n, data: { ...d, fieldRoles, role, dim: hasSelection && role === 'none', pinned: pinned === n.id } };
      }),
    [positioned, mode, roleOf, hasSelection, selectedDatasetId, pinned],
  );

  const rfEdges = useMemo<Edge[]>(() => {
    if (mode === 'table') {
      return tableVisible.edges.map((e: LineageEdge) => ({
        ...e,
        type: 'smoothstep',
        ...edgeStyle(
          hasSelection && lineage.has(e.source) && lineage.has(e.target),
          hasSelection,
          false,
          e.kind === 'view',
          e.crud,
        ),
      }));
    }
    return columnVisible.links.map(({ edge: e, source, target }) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: outHandle(e.sourceField),
      targetHandle: inHandle(e.targetField),
      zIndex: hasSelection && lineage.has(source) && lineage.has(target) ? 1 : 0,
      ...edgeStyle(hasSelection && lineage.has(source) && lineage.has(target), hasSelection, isIndirect(e)),
    }));
  }, [mode, tableVisible, columnVisible, hasSelection, lineage]);

  // ---- Search --------------------------------------------------------------

  const matches = useMemo<SearchMatch[]>(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const hit = (...s: string[]) => s.some((v) => v.toLowerCase().includes(term));
    const out: SearchMatch[] = [];
    for (const n of scoped.nodes) {
      if (mode === 'column' && n.type === 'job') continue;
      if (hit(n.name, n.namespace, n.title ?? '', n.description ?? '', n.archetype ?? '')) out.push({ id: n.id, kind: n.type, name: n.name, context: n.namespace });
    }
    if (mode === 'column') {
      for (const d of datasets) {
        for (const f of d.fields) {
          if (hit(f.name)) out.push({ id: colKey(d.id, f.name), kind: 'column', name: f.name, context: d.name });
        }
      }
    }
    return out.slice(0, 8);
  }, [query, scoped, datasets, mode]);

  const focusNode = (id: string) => {
    setQuery('');
    const target = graph?.nodes.find((n) => n.id === id);
    const nextMode: Mode = mode === 'column' && (target ? target.type === 'job' : id.startsWith('job:')) ? 'table' : mode;
    // A pinned node may have been hidden by the namespace filter; reveal it too.
    const revealedNamespaces =
      target && namespaces.length > 0 && !namespaces.includes(target.namespace)
        ? [...namespaces, target.namespace]
        : null;
    if (!revealedNamespaces && nextMode === mode && id === selectedId) {
      centerOn(id);
      return;
    }
    pendingCenter.current = id;
    updateSearch({
      mode: nextMode,
      selected: id,
      ...(revealedNamespaces ? { namespaces: revealedNamespaces } : {}),
    });
  };

  const togglePin = (id: string) => updateSearch((prev) => ({ pinned: prev.pinned === id ? '' : id }));

  const onNodeClick = (event: MouseEvent, n: Node) => {
    const field = (event.target as HTMLElement).closest('[data-field]')?.getAttribute('data-field');
    select(mode === 'column' && field != null ? colKey(n.id, field) : n.id);
  };


  return (
    <div className="app">
      <header className="topbar">
        <h1>Lineage explorer</h1>
        <nav className="nav" aria-label="Views">
          <Link to="/" className="nav-link on">
            Graph
          </Link>
          <Link to="/nodes" className="nav-link">
            Nodes
          </Link>
        </nav>
        <div className="segmented" role="radiogroup" aria-label="Lineage level">
          {(['table', 'column'] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? 'on' : ''}
              onClick={() => setMode(m)}
            >
              {m === 'table' ? 'Table lineage' : 'Column lineage'}
            </button>
          ))}
        </div>
        <div className="search">
          <input
            type="search"
            placeholder={mode === 'table' ? 'Find a job or dataset' : 'Find a dataset or column'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={mode === 'table' ? 'Find a job or dataset' : 'Find a dataset or column'}
          />
          {matches.length > 0 && (
            <ul className="results">
              {matches.map((m) => (
                <li key={m.id}>
                  <button onClick={() => focusNode(m.id)}>
                    <span className={`kind kind-${m.kind}`}>{m.kind}</span>
                    <span className="r-name">{m.name}</span>
                    <span className="r-ns">{m.context}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="field">
          <span>Namespace</span>
          <NamespacePicker
            namespaces={availableNamespaces}
            selected={namespaces}
            onChange={(next) => updateSearch({ namespaces: next })}
          />
        </label>
        <button className="btn" onClick={refreshDatabase} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh the database'}
        </button>
      </header>

      <main className="stage">
        {error && (
          <div className="banner error" role="alert">
            Could not load the lineage graph: {error}. Check the Quack server (it starts with `pnpm dev`) and the table and column names in shared/schema.ts.
          </div>
        )}
        {!error && !loading && graph && graph.nodes.length === 0 && (
          <div className="banner">No jobs or datasets found. Check that the database path and tables in shared/schema.ts are correct.</div>
        )}
        {!error && !loading && mode === 'column' && graph && graph.nodes.length > 0 && scoped.columnEdges.length === 0 && (
          <div className="banner">No column lineage recorded for these datasets. Check the column_lineage table in shared/schema.ts.</div>
        )}

        <div className="canvas">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            minZoom={0.1}
            maxZoom={1.75}
            onNodeClick={onNodeClick}
            onPaneClick={() => select(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} color="#d6dcdc" />
            <Controls showInteractive={false} showFitView={false} />
            <Panel position="top-right">
              <button className="btn" onClick={() => fitView({ padding: 0.2, duration: 300 })}>
                Fit view
              </button>
            </Panel>
            {pinnedNode && (
              <Panel position="top-left" className="pinned-panel">
                <PinnedPanel
                  node={pinnedNode}
                  selected={selectedId === pinnedNode.id}
                  degree={degree}
                  onDegreeChange={(next) => updateSearch({ degree: next })}
                  direction={direction}
                  onDirectionChange={(next) => updateSearch({ direction: next })}
                  onReveal={() => focusNode(pinnedNode.id)}
                  onUnpin={() => updateSearch({ pinned: '' })}
                />
              </Panel>
            )}
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => (n.type === 'job' ? '#0d6b62' : '#b9c3c4')}
              maskColor="rgba(243,245,244,0.7)"
            />
          </ReactFlow>
          <div className="legend" aria-label="Legend">
            {mode === 'table' ? (
              <>
                <span><i className="swatch ds" /> Dataset</span>
                <span><i className="swatch jb" /> Job</span>
                <span><i className="line view" /> View</span>
                {CRUD_LEGEND.filter((crud) => scoped.edges.some((e) => e.crud === crud)).map((crud) => (
                  <span key={crud}>
                    <i className={`line crud-${crud.toLowerCase()}`} /> {CRUD_LABEL[crud]}
                  </span>
                ))}
              </>
            ) : (
              <>
                <span><i className="line direct" /> Direct</span>
                <span><i className="line indirect" /> Indirect</span>
              </>
            )}
            <span><i className="swatch up" /> Upstream</span>
            <span><i className="swatch down" /> Downstream</span>
          </div>
        </div>

        {selection && (
          <aside className="panel">
            <Details
              key={selectedId}
              selection={selection}
              mode={mode}
              graph={scoped}
              nodeById={nodeById}
              upstreamCount={upstream.size}
              downstreamCount={downstream.size}
              isolate={isolate}
              pinnedId={pinned}
              onTogglePin={togglePin}
              onToggleIsolate={() => updateSearch((prev) => ({ isolate: !prev.isolate }))}
              onSelect={focusNode}
              onClose={() => select(null)}
            />
          </aside>
        )}
      </main>
    </div>
  );
}

interface DetailsProps {
  selection: Selection;
  mode: Mode;
  graph: Graph;
  nodeById: Map<string, LineageNode>;
  upstreamCount: number;
  downstreamCount: number;
  isolate: boolean;
  pinnedId: string;
  onTogglePin: (id: string) => void;
  onToggleIsolate: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function NodeLink({ node, onSelect }: { node: LineageNode | undefined; onSelect: (id: string) => void }) {
  if (!node) return null;
  return (
    <button className="link" onClick={() => onSelect(node.id)} title={`${node.namespace}\n${node.name}`}>
      {node.title && node.title !== node.name ? (
        <>
          <span>{node.title}</span>
          <span className="mono muted small">{node.name}</span>
        </>
      ) : (
        <span className="mono">{node.name}</span>
      )}
      <span className="muted small">{node.namespace}</span>
    </button>
  );
}

function PinnedPanel({
  node,
  selected,
  degree,
  onDegreeChange,
  direction,
  onDirectionChange,
  onReveal,
  onUnpin,
}: {
  node: LineageNode;
  selected: boolean;
  degree: LineageDegree;
  onDegreeChange: (degree: LineageDegree) => void;
  direction: LineageDirection;
  onDirectionChange: (direction: LineageDirection) => void;
  onReveal: () => void;
  onUnpin: () => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [lastDegree, setLastDegree] = useState<LineageDegree>(degree === 'all' ? '1' : degree);
  const title = node.title ?? node.name;
  const revealLabel = selected ? 'Center in graph' : 'Bring into view';

  useEffect(() => {
    if (degree !== 'all') setLastDegree(degree);
  }, [degree]);

  const changeDegree = (next: LineageDegree) => {
    if (next !== 'all') setLastDegree(next);
    onDegreeChange(next);
  };

  return (
    <div
      className={`pinned-card${collapsed ? ' collapsed' : ''}`}
      role="region"
      aria-label={`Pinned ${node.type}: ${node.name}`}
    >
      {collapsed ? (
        <div className="pinned-collapsed-row">
          <div className="pinned-name mono" title={node.name}>
            {title}
          </div>
          <div className="pinned-head-actions">
            <button className="icon-btn" onClick={onReveal} aria-label={revealLabel} title={revealLabel}>
              <LocateFixed size={15} aria-hidden="true" />
            </button>
            <button className="icon-btn" onClick={onUnpin} aria-label="Unpin node" title="Unpin node">
              <PinOff size={15} aria-hidden="true" />
            </button>
            <button
              className="icon-btn"
              onClick={() => setCollapsed(false)}
              aria-label="Expand pinned card"
              aria-expanded="false"
              title="Expand pinned card"
            >
              <ChevronDown size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="pinned-head">
            <span className="pinned-label">
              <Pin size={13} aria-hidden="true" />
              Pinned
            </span>
            <div className="pinned-head-actions">
              <button className="icon-btn" onClick={onUnpin} aria-label="Unpin node" title="Unpin node">
                <PinOff size={15} aria-hidden="true" />
              </button>
              <button
                className="icon-btn"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse pinned card"
                aria-expanded="true"
                title="Collapse pinned card"
              >
                <ChevronUp size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="pinned-badges">
            <span className={`kind kind-${node.type}`}>{node.type}</span>
            {node.archetype && <span className="archetype-badge static">{node.archetype}</span>}
          </div>
          <div className="pinned-name mono" title={node.name}>
            {title}
          </div>
          {node.title && node.title !== node.name && (
            <div className="pinned-sub mono muted small">{node.name}</div>
          )}
          <div className="pinned-sub muted small">{node.namespace}</div>
          {node.description && <p className="pinned-desc">{node.description}</p>}
          <div className="pinned-degree">
            <span>Degree</span>
            <div className="pinned-degree-controls">
              <select
                aria-label="Degree"
                value={degree === 'all' ? lastDegree : degree}
                disabled={degree === 'all'}
                onChange={(e) => changeDegree(e.target.value as LineageDegree)}
                title="Number of hops shown around the pinned node"
              >
                {(['1', '2', '3', '4'] as const).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <label className="pinned-degree-all" title="Do not limit the displayed nodes by degree">
                <input
                  type="checkbox"
                  checked={degree === 'all'}
                  onChange={(e) => changeDegree(e.target.checked ? 'all' : lastDegree)}
                />
                All
              </label>
            </div>
          </div>
          <div className="pinned-filter">
            <span>Show</span>
            <div className="pinned-radio" role="radiogroup" aria-label="Direction from the pinned node">
              {DIRECTION_OPTIONS.map(({ value, label, title }) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={direction === value}
                  className={direction === value ? 'on' : ''}
                  onClick={() => onDirectionChange(value)}
                  aria-label={title}
                  title={title}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button className="btn small pinned-reveal" onClick={onReveal}>
            {revealLabel}
          </button>
        </>
      )}
    </div>
  );
}

function Details(props: DetailsProps) {
  const {
    selection,
    mode,
    graph,
    nodeById,
    upstreamCount,
    downstreamCount,
    isolate,
    pinnedId,
    onTogglePin,
    onToggleIsolate,
    onSelect,
    onClose,
  } = props;
  const isColumn = selection.kind === 'column';
  const kind = isColumn ? 'column' : selection.node.type;
  const heading = isColumn ? selection.field.name : selection.node.title ?? selection.node.name;
  const unit = mode === 'column' ? ' columns' : '';
  const isPinned = !isColumn && pinnedId === selection.node.id;

  return (
    <div className="details">
      <div className="details-head">
        <span className={`kind kind-${kind}`}>{kind}</span>
        <div className="details-head-actions">
          {!isColumn && (
            <button
              className={`btn small pin-toggle${isPinned ? ' on' : ''}`}
              onClick={() => onTogglePin(selection.node.id)}
              aria-pressed={isPinned}
              aria-label={isPinned ? 'Unpin node' : 'Pin node to the viewport'}
              title={isPinned ? 'Unpin this node from the viewport' : 'Pin this node to the viewport'}
            >
              <Pin size={15} aria-hidden="true" />
            </button>
          )}
          {!isColumn && selection.node.archetype && (
            <span className="archetype-badge static">{selection.node.archetype}</span>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Close details">
            ×
          </button>
        </div>
      </div>
      <h2 className="mono">{heading}</h2>
      {isColumn ? (
        <p className="muted">
          <button className="link inline" onClick={() => onSelect(selection.dataset.id)}>
            <span className="mono">{selection.dataset.name}</span>
          </button>
          {selection.field.type && <span className="mono"> · {selection.field.type}</span>}
        </p>
      ) : (
        <>
          <p className="mono muted">
            {selection.node.title && selection.node.title !== selection.node.name
              ? `${selection.node.name} · `
              : ''}
            {selection.node.namespace}
          </p>
          {selection.node.description && <p>{selection.node.description}</p>}
        </>
      )}
      {isColumn && selection.field.description && <p>{selection.field.description}</p>}

      <dl className="stats">
        <div>
          <dt>Upstream{unit}</dt>
          <dd>{upstreamCount}</dd>
        </div>
        <div>
          <dt>Downstream{unit}</dt>
          <dd>{downstreamCount}</dd>
        </div>
      </dl>

      <button className={`btn wide${isolate ? ' on' : ''}`} onClick={onToggleIsolate}>
        {isolate ? 'Show the full graph' : 'Show only this lineage'}
      </button>

      {isColumn ? (
        <ColumnDetails dataset={selection.dataset} field={selection.field} graph={graph} nodeById={nodeById} onSelect={onSelect} />
      ) : selection.node.type === 'job' ? (
        <>
          <NodeList title="Reads" ids={graph.edges.filter((e) => e.target === selection.node.id && e.kind === 'io').map((e) => e.source)} nodeById={nodeById} onSelect={onSelect} />
          <NodeList title="Writes" ids={graph.edges.filter((e) => e.source === selection.node.id && e.kind === 'io').map((e) => e.target)} nodeById={nodeById} onSelect={onSelect} />
        </>
      ) : (
        <>
          <NodeList title="Written by" ids={graph.edges.filter((e) => e.target === selection.node.id && e.kind === 'io').map((e) => e.source)} nodeById={nodeById} onSelect={onSelect} />
          <NodeList title="View of" ids={graph.edges.filter((e) => e.target === selection.node.id && e.kind === 'view').map((e) => e.source)} nodeById={nodeById} onSelect={onSelect} />
          <NodeList title="Read by" ids={graph.edges.filter((e) => e.source === selection.node.id && e.kind === 'io').map((e) => e.target)} nodeById={nodeById} onSelect={onSelect} />
          <NodeList title="Views" ids={graph.edges.filter((e) => e.source === selection.node.id && e.kind === 'view').map((e) => e.target)} nodeById={nodeById} onSelect={onSelect} />
          <section>
            <h3>Columns</h3>
            {selection.node.fields.length === 0 ? (
              <p className="muted">No column metadata.</p>
            ) : (
              <ul className="items">
                {selection.node.fields.map((f) => (
                  <li key={f.name}>
                    {mode === 'column' ? (
                      <button className="link" onClick={() => onSelect(colKey(selection.node.id, f.name))}>
                        <span className="mono">{f.name}</span>
                        {f.type && <span className="muted small mono">{f.type}</span>}
                      </button>
                    ) : (
                      <div className="item-row">
                        <span className="mono">{f.name}</span>
                        {f.type && <span className="muted small mono">{f.type}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function NodeList({ title, ids, nodeById, onSelect }: { title: string; ids: string[]; nodeById: Map<string, LineageNode>; onSelect: (id: string) => void }) {
  return (
    <section>
      <h3>{title}</h3>
      {ids.length === 0 ? (
        <p className="muted">None recorded.</p>
      ) : (
        <ul className="items">
          {ids.map((id) => (
            <li key={id}>
              <NodeLink node={nodeById.get(id)} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ColumnDetails({ dataset, field, graph, nodeById, onSelect }: { dataset: DatasetNode; field: DatasetField; graph: Graph; nodeById: Map<string, LineageNode>; onSelect: (id: string) => void }) {
  const inbound = graph.columnEdges.filter((e) => e.target === dataset.id && e.targetField === field.name);
  const outbound = graph.columnEdges.filter((e) => e.source === dataset.id && e.sourceField === field.name);
  const list = (title: string, edges: ColumnEdge[], side: 'source' | 'target') => (
    <section>
      <h3>{title}</h3>
      {edges.length === 0 ? (
        <p className="muted">None recorded.</p>
      ) : (
        <ul className="items">
          {edges.map((e) => {
            const ds = nodeById.get(e[side]);
            const f = side === 'source' ? e.sourceField : e.targetField;
            const job = e.job ? nodeById.get(e.job) : undefined;
            return (
              <li key={e.id}>
                <button className="link" onClick={() => onSelect(colKey(e[side], f))}>
                  <span className="mono">{f}</span>
                  <span className="muted small mono">{ds?.name}</span>
                </button>
                <div className="item-meta">
                  <span className={`badge-t${isIndirect(e) ? ' indirect' : ''}`}>{transformationLabel(e)}</span>
                  {job && (
                    <span className="muted small" title={job.description ?? undefined}>
                      via {job.name}
                    </span>
                  )}
                </div>
                {e.description && <div className="muted small edge-description">{e.description}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
  return (
    <>
      {list('Derived from', inbound, 'source')}
      {list('Feeds', outbound, 'target')}
    </>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Explorer />
    </ReactFlowProvider>
  );
}
