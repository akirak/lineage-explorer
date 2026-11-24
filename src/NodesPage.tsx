import { useMemo } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Button } from '@base-ui-components/react/button';
import { Field } from '@base-ui-components/react/field';
import { Input } from '@base-ui-components/react/input';
import { Select } from '@base-ui-components/react/select';
import { ArrowRight, Check, ChevronDown, X } from 'lucide-react';
import type { LineageNode } from '../shared/types.ts';
import type { NodesSearch } from './search.ts';
import { useGraph } from './useGraph.ts';

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** `[value, label]` pairs; the first one should be the "all" entry. */
  options: [string, string][];
}

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <Field.Root className="field">
      <Field.Label>{label}</Field.Label>
      <Select.Root value={value} onValueChange={(next) => onChange(next ?? options[0][0])}>
        <Select.Trigger className="select-trigger" aria-label={label}>
          <Select.Value />
          <Select.Icon className="select-icon">
            <ChevronDown size={14} aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="popup-positioner" sideOffset={6} alignItemWithTrigger={false}>
            <Select.Popup className="select-popup popup">
              <Select.List>
                {options.map(([optionValue, optionLabel]) => (
                  <Select.Item key={optionValue} value={optionValue} className="select-item">
                    <Select.ItemIndicator className="select-check">
                      <Check size={13} strokeWidth={3} aria-hidden="true" />
                    </Select.ItemIndicator>
                    <Select.ItemText>{optionLabel}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </Field.Root>
  );
}

const typeLabel = (n: LineageNode) => (
  <span className="type-label">
    {n.title && n.title !== n.name ? (
      <>
        <span>{n.title}</span>
        <span className="mono muted type-label-name">{n.name}</span>
      </>
    ) : (
      <span className="mono">{n.name}</span>
    )}
  </span>
);

export default function NodesPage() {
  const { q, namespace, type, archetype } = useSearch({ from: '/nodes' });
  const navigate = useNavigate({ from: '/nodes' });
  const { graph, error, loading } = useGraph();

  const update = (patch: Partial<NodesSearch>) =>
    navigate({ search: (prev) => ({ ...(prev as NodesSearch), ...patch }) });

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
    <main className="nodes-main">
      <form className="filters" onSubmit={(e) => e.preventDefault()} role="search">
        <Field.Root className="field grow">
          <Field.Label>Search</Field.Label>
          <Input
            type="search"
            placeholder="Filter by name, namespace, or description"
            value={q}
            onChange={(e) => update({ q: e.target.value })}
          />
        </Field.Root>
        <FilterSelect
          label="Namespace"
          value={namespace}
          onChange={(value) => update({ namespace: value })}
          options={[['all', 'All namespaces'], ...namespaces.map((n): [string, string] => [n, n])]}
        />
        <FilterSelect
          label="Type"
          value={type}
          onChange={(value) => update({ type: value as NodesSearch['type'] })}
          options={[
            ['all', 'All types'],
            ['job', 'Jobs'],
            ['dataset', 'Datasets'],
          ]}
        />
        <FilterSelect
          label="Archetype"
          value={archetype}
          onChange={(value) => update({ archetype: value })}
          options={[['all', 'All archetypes'], ...archetypes.map((a): [string, string] => [a, a])]}
        />
        <Button
          className="btn"
          type="button"
          onClick={() => update({ q: '', namespace: 'all', type: 'all', archetype: 'all' })}
          disabled={!hasFilters}
        >
          <X size={15} aria-hidden="true" />
          Clear
        </Button>
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
                        search={{ selected: n.id, namespaces: namespace === 'all' ? [] : [namespace] }}
                        className="btn small"
                        aria-label={`Browse ${n.name} in the graph`}
                      >
                        Graph
                        <ArrowRight size={14} aria-hidden="true" />
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
  );
}
