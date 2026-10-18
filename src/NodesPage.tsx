import { useMemo } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { LineageNode } from '../shared/types.ts';
import type { NodesSearch } from './search.ts';
import { useGraph } from './useGraph.ts';

const typeLabel = (n: LineageNode) => (n.title && n.title !== n.name ? `${n.name} · ${n.title}` : n.name);

export default function NodesPage() {
  const { q, namespace, type, archetype } = useSearch({ from: '/nodes' });
  const navigate = useNavigate({ from: '/nodes' });
  const { graph, error, loading } = useGraph();

  const update = (patch: Partial<NodesSearch>) =>
    navigate({ search: (prev) => ({ ...(prev as NodesSearch), ...patch }), replace: true });

  const namespaces = useMemo(
    () => (graph ? [...new Set(graph.nodes.map((n) => n.namespace))].sort() : []),
    [graph],
  );

  const archetypes = useMemo(
    () =>
      graph
        ? [...new Set(graph.nodes.map((n) => n.archetype).filter((a): a is string => a != null))].sort()
        : [],
    [graph],
  );

  const nodes = useMemo(() => {
    if (!graph) return [];
    const term = q.trim().toLowerCase();
    return graph.nodes
      .filter((n) => namespace === 'all' || n.namespace === namespace)
      .filter((n) => type === 'all' || n.type === type)
      .filter((n) => archetype === 'all' || n.archetype === archetype)
      .filter((n) => {
        if (!term) return true;
        return [n.name, n.namespace, n.title ?? '', n.description ?? '', n.archetype ?? ''].some((v) =>
          v.toLowerCase().includes(term),
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.namespace.localeCompare(b.namespace));
  }, [graph, q, namespace, type, archetype]);

  const hasFilters = q !== '' || namespace !== 'all' || type !== 'all' || archetype !== 'all';

  return (
    <div className="app">
      <header className="topbar">
        <h1>Lineage explorer</h1>
        <nav className="nav" aria-label="Views">
          <Link to="/" className="nav-link">
            Graph
          </Link>
          <Link to="/nodes" className="nav-link" activeProps={{ className: 'nav-link on' }}>
            Nodes
          </Link>
        </nav>
      </header>

      <main className="nodes-main">
        <form className="filters" onSubmit={(e) => e.preventDefault()} role="search">
          <label className="field grow">
            <span>Search</span>
            <input
              type="search"
              placeholder="Filter by name, namespace, or description"
              value={q}
              onChange={(e) => update({ q: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Namespace</span>
            <select value={namespace} onChange={(e) => update({ namespace: e.target.value })}>
              <option value="all">All namespaces</option>
              {namespaces.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Type</span>
            <select value={type} onChange={(e) => update({ type: e.target.value as NodesSearch['type'] })}>
              <option value="all">All types</option>
              <option value="job">Jobs</option>
              <option value="dataset">Datasets</option>
            </select>
          </label>
          <label className="field">
            <span>Archetype</span>
            <select value={archetype} onChange={(e) => update({ archetype: e.target.value })}>
              <option value="all">All archetypes</option>
              {archetypes.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="button" onClick={() => update({ q: '', namespace: 'all', type: 'all', archetype: 'all' })} disabled={!hasFilters}>
            Clear
          </button>
        </form>

        {error && (
          <div className="banner error inline" role="alert">
            Could not load the lineage graph: {error}.
          </div>
        )}
        {!error && loading && <p className="muted nodes-status">Loading…</p>}
        {!error && !loading && graph && (
          <>
            <p className="muted nodes-status">
              {nodes.length} of {graph.nodes.length} nodes
            </p>
            <div className="table-wrap">
              <table className="nodes-table">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Name</th>
                    <th scope="col">Namespace</th>
                    <th scope="col">Archetype</th>
                    <th scope="col">Description</th>
                    <th scope="col">
                      <span className="sr-only">Graph</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((n) => (
                    <tr key={n.id}>
                      <td>
                        <span className={`kind kind-${n.type}`}>{n.type}</span>
                      </td>
                      <td className="mono name-cell" title={n.title ?? n.name}>
                        {typeLabel(n)}
                      </td>
                      <td className="mono muted">{n.namespace}</td>
                      <td>
                        {n.archetype ? (
                          <span className="archetype-badge static">{n.archetype}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="desc-cell" title={n.description ?? undefined}>
                        {n.description}
                      </td>
                      <td className="actions-cell">
                        <Link
                          to="/"
                          search={{ selected: n.id, namespace }}
                          className="btn small"
                          aria-label={`Browse ${n.name} in the graph`}
                        >
                          Graph →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {nodes.length === 0 && <p className="muted empty">No nodes match these filters.</p>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
