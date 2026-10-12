import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import type { ColumnEdge, DatasetField, DatasetNode, Graph, LineageEdge, LineageNode } from '../shared/types.ts';
import { fetchGraph } from './api.ts';
import { adjacency, layoutNodes, tableHeight, traverse, NODE_W, NODE_H, TABLE_W } from './layout.ts';
import { inHandle, nodeTypes, outHandle, type LineageFlowNode, type Role, type TableFlowNode } from './nodes.tsx';

const EDGE_IDLE = '#9aa6a9';
const EDGE_ACTIVE = '#0d6b62';

type Mode = 'table' | 'column';

const colKey = (datasetId: string, field: string) => `${datasetId}\u0001${field}`;
const splitColKey = (key: string) => {
  const i = key.lastIndexOf('\u0001');
  return i < 0 ? null : { datasetId: key.slice(0, i), field: key.slice(i + 1) };
};

const initialMode = (): Mode => (new URLSearchParams(window.location.search).get('mode') === 'column' ? 'column' : 'table');

const transformationLabel = (e: ColumnEdge) =>
  [e.transformationType, e.transformationSubtype].filter(Boolean).join(' · ') || 'Unknown transformation';

const isIndirect = (e: ColumnEdge) => e.transformationType?.toUpperCase() === 'INDIRECT';

type SearchMatch = { id: string; kind: 'job' | 'dataset' | 'column'; name: string; context: string };

type Selection =
  | { kind: 'node'; node: LineageNode }
  | { kind: 'column'; dataset: DatasetNode; field: DatasetField };

function edgeStyle(active: boolean, hasSelection: boolean, dashed = false) {
  const color = active ? EDGE_ACTIVE : EDGE_IDLE;
  return {
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    style: {
      stroke: color,
      strokeWidth: active ? 2 : 1.25,
      strokeDasharray: dashed ? '5 4' : undefined,
      opacity: hasSelection && !active ? 0.18 : 1,
    },
  };
}

function Explorer() {
  const { setCenter, fitView } = useReactFlow();
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setModeState] = useState<Mode>(initialMode);
  const [namespace, setNamespace] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isolate, setIsolate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGraph(await fetchGraph());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setMode = (next: Mode) => {
    if (next === mode) return;
    // A selected column maps to its dataset in table mode; a selected job has no counterpart in column mode.
    if (next === 'table' && selectedId) {
      const col = splitColKey(selectedId);
      if (col) setSelectedId(col.datasetId);
    }
    if (next === 'column' && selectedId?.startsWith('job:')) setSelectedId(null);
    setModeState(next);
    const url = new URL(window.location.href);
    if (next === 'column') url.searchParams.set('mode', 'column');
    else url.searchParams.delete('mode');
    window.history.replaceState(null, '', url);
  };

  const namespaces = useMemo(
    () => (graph ? [...new Set(graph.nodes.map((n) => n.namespace))].sort() : []),
    [graph],
  );

  const scoped = useMemo<Graph>(() => {
    if (!graph) return { nodes: [], edges: [], columnEdges: [] };
    if (namespace === 'all') return graph;
    const nodes = graph.nodes.filter((n) => n.namespace === namespace);
    const ids = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
      columnEdges: graph.columnEdges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    };
  }, [graph, namespace]);

  const nodeById = useMemo(() => new Map(scoped.nodes.map((n) => [n.id, n])), [scoped]);
  const datasets = useMemo(() => scoped.nodes.filter((n): n is DatasetNode => n.type === 'dataset'), [scoped]);

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

  const { upstream, downstream } = useMemo(() => {
    const adj = mode === 'table' ? tableAdj : columnAdj;
    return { upstream: traverse(seeds, adj.up), downstream: traverse(seeds, adj.down) };
  }, [mode, tableAdj, columnAdj, seeds]);

  const lineage = useMemo(() => new Set([...seeds, ...upstream, ...downstream]), [seeds, upstream, downstream]);

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

  const tableVisible = useMemo(() => {
    if (!isolating) return { nodes: scoped.nodes, edges: scoped.edges };
    return {
      nodes: scoped.nodes.filter((n) => lineage.has(n.id)),
      edges: scoped.edges.filter((e) => lineage.has(e.source) && lineage.has(e.target)),
    };
  }, [scoped, isolating, lineage]);

  const columnVisible = useMemo(() => {
    if (!isolating) return { datasets, links: colLinks };
    // Keep only datasets on the lineage, and only their lineage columns.
    const kept = datasets
      .map((d) => ({ ...d, fields: d.fields.filter((f) => lineage.has(colKey(d.id, f.name))) }))
      .filter((d) => d.id === selectedDatasetId || d.fields.length > 0);
    return { datasets: kept, links: colLinks.filter((l) => lineage.has(l.source) && lineage.has(l.target)) };
  }, [datasets, colLinks, isolating, lineage, selectedDatasetId]);

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

  const rfNodes = useMemo<Node[]>(
    () =>
      positioned.map((n) => {
        if (mode === 'table') {
          const role = roleOf(n.id);
          return { ...n, data: { ...n.data, role, dim: hasSelection && role === 'none' } };
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
        return { ...n, data: { ...d, fieldRoles, role, dim: hasSelection && role === 'none' } };
      }),
    [positioned, mode, roleOf, hasSelection, selectedDatasetId],
  );

  const rfEdges = useMemo<Edge[]>(() => {
    if (mode === 'table') {
      return tableVisible.edges.map((e: LineageEdge) => ({
        ...e,
        type: 'smoothstep',
        ...edgeStyle(hasSelection && lineage.has(e.source) && lineage.has(e.target), hasSelection),
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

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
    return () => clearTimeout(t);
  }, [positioned, fitView]);

  // ---- Search --------------------------------------------------------------

  const matches = useMemo<SearchMatch[]>(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const hit = (...s: string[]) => s.some((v) => v.toLowerCase().includes(term));
    const out: SearchMatch[] = [];
    for (const n of scoped.nodes) {
      if (mode === 'column' && n.type === 'job') continue;
      if (hit(n.name, n.namespace)) out.push({ id: n.id, kind: n.type, name: n.name, context: n.namespace });
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
    if (mode === 'column' && id.startsWith('job:')) setMode('table');
    setSelectedId(id);
    setQuery('');
    const nodeId = splitColKey(id)?.datasetId ?? id;
    const n = positioned.find((p) => p.id === nodeId);
    if (!n) return;
    const [w, h] =
      n.type === 'table' ? [TABLE_W, tableHeight((n.data as TableFlowNode['data']).fields.length)] : [NODE_W, NODE_H];
    setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: 1, duration: 400 });
  };

  const onNodeClick = (event: MouseEvent, n: Node) => {
    const field = (event.target as HTMLElement).closest('[data-field]')?.getAttribute('data-field');
    setSelectedId(mode === 'column' && field != null ? colKey(n.id, field) : n.id);
  };

  const columnCount = datasets.reduce((sum, d) => sum + d.fields.length, 0);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Lineage explorer</h1>
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
          <select value={namespace} onChange={(e) => setNamespace(e.target.value)}>
            <option value="all">All namespaces</option>
            {namespaces.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Reload from database'}
        </button>
      </header>

      <main className="stage">
        {error && (
          <div className="banner error" role="alert">
            Could not load the lineage graph: {error}. Check the table and column names in server/schema.ts.
          </div>
        )}
        {!error && !loading && graph && graph.nodes.length === 0 && (
          <div className="banner">No jobs or datasets found. Check that the database path and tables in server/schema.ts are correct.</div>
        )}
        {!error && !loading && mode === 'column' && graph && graph.nodes.length > 0 && scoped.columnEdges.length === 0 && (
          <div className="banner">No column lineage recorded for these datasets. Check the column_lineage table in server/schema.ts.</div>
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
            onPaneClick={() => setSelectedId(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} color="#d6dcdc" />
            <Controls showInteractive={false} />
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

        <aside className={`panel${selection ? ' open' : ''}`}>
          {selection ? (
            <Details
              key={selectedId}
              selection={selection}
              mode={mode}
              graph={scoped}
              nodeById={nodeById}
              upstreamCount={upstream.size}
              downstreamCount={downstream.size}
              isolate={isolate}
              onToggleIsolate={() => setIsolate((v) => !v)}
              onSelect={focusNode}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="panel-empty">
              <p>
                {mode === 'table'
                  ? 'Select a job or dataset to trace what feeds it and what depends on it.'
                  : 'Select a column to trace the columns it derives from and the columns that depend on it.'}
              </p>
              {graph && (
                <p className="counts">
                  {mode === 'table'
                    ? `${scoped.nodes.filter((n) => n.type === 'job').length} jobs, ${datasets.length} datasets`
                    : `${datasets.length} datasets, ${columnCount} columns, ${scoped.columnEdges.length} column edges`}
                </p>
              )}
            </div>
          )}
        </aside>
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
  onToggleIsolate: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function NodeLink({ node, onSelect }: { node: LineageNode | undefined; onSelect: (id: string) => void }) {
  if (!node) return null;
  return (
    <button className="link" onClick={() => onSelect(node.id)} title={`${node.namespace}\n${node.name}`}>
      <span className="mono">{node.name}</span>
      <span className="muted small">{node.namespace}</span>
    </button>
  );
}

function Details(props: DetailsProps) {
  const { selection, mode, graph, nodeById, upstreamCount, downstreamCount, isolate, onToggleIsolate, onSelect, onClose } =
    props;
  const isColumn = selection.kind === 'column';
  const kind = isColumn ? 'column' : selection.node.type;
  const title = isColumn ? selection.field.name : selection.node.name;
  const unit = mode === 'column' ? ' columns' : '';

  return (
    <div className="details">
      <div className="details-head">
        <span className={`kind kind-${kind}`}>{kind}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </div>
      <h2 className="mono">{title}</h2>
      {isColumn ? (
        <p className="muted">
          <button className="link inline" onClick={() => onSelect(selection.dataset.id)}>
            <span className="mono">{selection.dataset.name}</span>
          </button>
          {selection.field.type && <span className="mono"> · {selection.field.type}</span>}
        </p>
      ) : (
        <p className="mono muted">{selection.node.namespace}</p>
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
          <NodeList title="Reads" ids={graph.edges.filter((e) => e.target === selection.node.id).map((e) => e.source)} nodeById={nodeById} onSelect={onSelect} />
          <NodeList title="Writes" ids={graph.edges.filter((e) => e.source === selection.node.id).map((e) => e.target)} nodeById={nodeById} onSelect={onSelect} />
        </>
      ) : (
        <>
          <NodeList title="Written by" ids={graph.edges.filter((e) => e.target === selection.node.id).map((e) => e.source)} nodeById={nodeById} onSelect={onSelect} />
          <NodeList title="Read by" ids={graph.edges.filter((e) => e.source === selection.node.id).map((e) => e.target)} nodeById={nodeById} onSelect={onSelect} />
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
                  {job && <span className="muted small">via {job.name}</span>}
                </div>
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
