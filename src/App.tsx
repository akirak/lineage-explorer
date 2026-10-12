import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useReactFlow,
  type Edge,
} from '@xyflow/react';
import type { Graph, JobRun, LineageNode } from '../shared/types.ts';
import { fetchGraph, fetchJobRuns } from './api.ts';
import { layoutNodes, traverse, NODE_W, NODE_H } from './layout.ts';
import { nodeTypes, STATE_LABEL, stateKey, type LineageFlowNode, type Role } from './nodes.tsx';

const EDGE_IDLE = '#9aa6a9';
const EDGE_ACTIVE = '#0d6b62';

function formatTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function formatDuration(value: JobRun['duration_ms']) {
  if (value == null) return '—';
  const ms = Number(value);
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

function Explorer() {
  const { setCenter, fitView } = useReactFlow();
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  const namespaces = useMemo(
    () => (graph ? [...new Set(graph.nodes.map((n) => n.namespace))].sort() : []),
    [graph],
  );

  const scoped = useMemo<Graph>(() => {
    if (!graph) return { nodes: [], edges: [] };
    if (namespace === 'all') return graph;
    const nodes = graph.nodes.filter((n) => n.namespace === namespace);
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [graph, namespace]);

  const { upstream, downstream } = useMemo(() => {
    const up = new Map<string, string[]>();
    const down = new Map<string, string[]>();
    for (const e of scoped.edges) {
      if (!up.has(e.target)) up.set(e.target, []);
      up.get(e.target)!.push(e.source);
      if (!down.has(e.source)) down.set(e.source, []);
      down.get(e.source)!.push(e.target);
    }
    if (!selectedId) return { upstream: new Set<string>(), downstream: new Set<string>() };
    return { upstream: traverse(selectedId, up), downstream: traverse(selectedId, down) };
  }, [scoped, selectedId]);

  const hasSelection = selectedId !== null && scoped.nodes.some((n) => n.id === selectedId);

  const visible = useMemo<Graph>(() => {
    if (!(isolate && hasSelection)) return scoped;
    const keep = new Set([selectedId, ...upstream, ...downstream]);
    return {
      nodes: scoped.nodes.filter((n) => keep.has(n.id)),
      edges: scoped.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    };
  }, [scoped, isolate, hasSelection, selectedId, upstream, downstream]);

  const positioned = useMemo(
    () =>
      layoutNodes(
        visible.nodes.map((n) => ({ id: n.id, type: n.type, data: { ...n } }) as LineageFlowNode),
        visible.edges,
      ),
    [visible],
  );

  const rfNodes = useMemo(
    () =>
      positioned.map((n): LineageFlowNode => {
        let role: Role = 'none';
        if (hasSelection) {
          if (n.id === selectedId) role = 'selected';
          else if (upstream.has(n.id)) role = 'up';
          else if (downstream.has(n.id)) role = 'down';
        }
        return { ...n, data: { ...n.data, role, dim: hasSelection && role === 'none' } } as LineageFlowNode;
      }),
    [positioned, hasSelection, selectedId, upstream, downstream],
  );

  const rfEdges = useMemo<Edge[]>(() => {
    const lineage = new Set([selectedId, ...upstream, ...downstream]);
    return visible.edges.map((e) => {
      const active = hasSelection && lineage.has(e.source) && lineage.has(e.target);
      const color = active ? EDGE_ACTIVE : EDGE_IDLE;
      return {
        ...e,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        style: { stroke: color, strokeWidth: active ? 2 : 1.25, opacity: hasSelection && !active ? 0.18 : 1 },
      };
    });
  }, [visible, hasSelection, selectedId, upstream, downstream]);

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
    return () => clearTimeout(t);
  }, [positioned, fitView]);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return scoped.nodes
      .filter((n) => n.name.toLowerCase().includes(term) || n.namespace.toLowerCase().includes(term))
      .slice(0, 8);
  }, [query, scoped]);

  const focusNode = (id: string) => {
    setSelectedId(id);
    setQuery('');
    const n = positioned.find((p) => p.id === id);
    if (n) setCenter(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, { zoom: 1, duration: 400 });
  };

  const selected = hasSelection ? scoped.nodes.find((n) => n.id === selectedId) : null;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Lineage explorer</h1>
        <div className="search">
          <input
            type="search"
            placeholder="Find a job or dataset"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find a job or dataset"
          />
          {matches.length > 0 && (
            <ul className="results">
              {matches.map((m) => (
                <li key={m.id}>
                  <button onClick={() => focusNode(m.id)}>
                    <span className={`kind kind-${m.type}`}>{m.type}</span>
                    <span className="r-name">{m.name}</span>
                    <span className="r-ns">{m.namespace}</span>
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

        <div className="canvas">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            minZoom={0.1}
            maxZoom={1.75}
            onNodeClick={(_, n) => setSelectedId(n.id)}
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
            <span><i className="swatch ds" /> Dataset</span>
            <span><i className="swatch jb" /> Job, dot shows latest run state</span>
            <span><i className="swatch up" /> Upstream</span>
            <span><i className="swatch down" /> Downstream</span>
          </div>
        </div>

        <aside className={`panel${selected ? ' open' : ''}`}>
          {selected ? (
            <Details
              key={selected.id}
              node={selected}
              upstreamCount={upstream.size}
              downstreamCount={downstream.size}
              isolate={isolate}
              onToggleIsolate={() => setIsolate((v) => !v)}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="panel-empty">
              <p>Select a job or dataset to trace what feeds it and what depends on it.</p>
              {graph && (
                <p className="counts">
                  {scoped.nodes.filter((n) => n.type === 'job').length} jobs,{' '}
                  {scoped.nodes.filter((n) => n.type === 'dataset').length} datasets
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
  node: LineageNode;
  upstreamCount: number;
  downstreamCount: number;
  isolate: boolean;
  onToggleIsolate: () => void;
  onClose: () => void;
}

function Details({ node, upstreamCount, downstreamCount, isolate, onToggleIsolate, onClose }: DetailsProps) {
  const [runs, setRuns] = useState<JobRun[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);

  useEffect(() => {
    if (node.type !== 'job') return;
    let cancelled = false;
    fetchJobRuns(node.namespace, node.name)
      .then((r) => !cancelled && setRuns(r))
      .catch((e: unknown) => !cancelled && setRunsError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [node]);

  return (
    <div className="details">
      <div className="details-head">
        <span className={`kind kind-${node.type}`}>{node.type}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </div>
      <h2 className="mono">{node.name}</h2>
      <p className="mono muted">{node.namespace}</p>

      <dl className="stats">
        <div>
          <dt>Upstream</dt>
          <dd>{upstreamCount}</dd>
        </div>
        <div>
          <dt>Downstream</dt>
          <dd>{downstreamCount}</dd>
        </div>
      </dl>

      <button className={`btn wide${isolate ? ' on' : ''}`} onClick={onToggleIsolate}>
        {isolate ? 'Show the full graph' : 'Show only this lineage'}
      </button>

      {node.type === 'job' && (
        <section>
          <h3>Recent runs</h3>
          {runsError && <p className="error-text">{runsError}</p>}
          {!runs && !runsError && <p className="muted">Loading runs…</p>}
          {runs && runs.length === 0 && <p className="muted">This job has no recorded runs.</p>}
          {runs && runs.length > 0 && (
            <ul className="runs">
              {runs.map((r) => (
                <li key={r.run_id}>
                  <div className="run-top">
                    <span className={`badge state-${stateKey(r.state)}`}>{(r.state && STATE_LABEL[r.state]) || r.state || 'Unknown'}</span>
                    <span className="muted">{formatDuration(r.duration_ms)}</span>
                  </div>
                  <div className="mono run-id" title={r.run_id}>{r.run_id}</div>
                  <div className="muted small">{formatTime(r.started_at)}</div>
                  {r.parent_run_id && (
                    <div className="muted small mono" title={r.parent_run_id}>
                      parent {r.parent_run_id.slice(0, 8)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Explorer />
    </ReactFlowProvider>
  );
}
