import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Accordion } from '@base-ui-components/react/accordion';
import { Button } from '@base-ui-components/react/button';
import { Field } from '@base-ui-components/react/field';
import { Input } from '@base-ui-components/react/input';
import { Tabs } from '@base-ui-components/react/tabs';
import { ArrowRight, Check, ChevronDown, ListFilter, Pin, Plus, Trash2, X } from 'lucide-react';
import type { LineageNode } from '../shared/types.ts';
import {
  FILTER_FIELD_OPTIONS,
  FILTER_OPERATOR_OPTIONS,
  countFilters,
  filterNeedsValue,
  filtersSignature,
  hasActiveFilters,
  namespaceSelectionSignature,
  nodeMatchesFilters,
  type FilterField,
  type FilterOperator,
  type NamespaceFilterGroup,
  type NodeFilter,
} from './filters.ts';
import { createFilterSet, updateFilterSet, useFilterSets } from './filterStore.ts';
import FilterSelect from './FilterSelect.tsx';
import NamespacePicker from './NamespacePicker.tsx';
import type { NodesSearch } from './search.ts';
import { useGraph } from './useGraph.ts';

interface QueryEditorProps {
  /** Every namespace in the graph, used to populate the selection menu. */
  namespaces: string[];
  /** Entry namespaces for the editor; an empty list means all namespaces. */
  selectedNamespaces: string[];
  groups: NamespaceFilterGroup[];
  onChange: (next: NamespaceFilterGroup[]) => void;
  /** Namespace to focus in the table while the accordion is open. */
  onNamespaceFocus: (namespace: string | null) => void;
}

/**
 * Per-namespace query editor. The selected namespaces are listed as vertical
 * tabs; each tab holds any number of field/operator/value rules, and all rules
 * in a tab are ANDed. Namespaces with no selected filter group are unaffected.
 */
function QueryEditor({
  namespaces,
  selectedNamespaces,
  groups,
  onChange,
  onNamespaceFocus,
}: QueryEditorProps) {
  const total = countFilters(groups);

  // An empty selection means all namespaces, matching the Graph view.
  const tabNamespaces = useMemo(() => {
    const source =
      selectedNamespaces.length > 0
        ? selectedNamespaces
        : [...namespaces, ...groups.map((group) => group.namespace)];
    return [...new Set(source)].sort((a, b) => a.localeCompare(b));
  }, [namespaces, selectedNamespaces, groups]);

  const [activeNamespace, setActiveNamespace] = useState(tabNamespaces[0] ?? '');
  const [open, setOpen] = useState(true);
  const currentNamespace = tabNamespaces.includes(activeNamespace)
    ? activeNamespace
    : (tabNamespaces[0] ?? '');

  useEffect(() => {
    onNamespaceFocus(open ? currentNamespace || null : null);
  }, [open, currentNamespace, onNamespaceFocus]);

  const groupFor = (namespace: string) =>
    groups.find((group) => group.namespace === namespace);

  const setRules = (namespace: string, next: NodeFilter[]) => {
    const exists = groups.some((group) => group.namespace === namespace);
    if (!exists) {
      if (next.length > 0) onChange([...groups, { namespace, filters: next }]);
      return;
    }
    onChange(
      next.length > 0
        ? groups.map((group) =>
            group.namespace === namespace ? { ...group, filters: next } : group,
          )
        : groups.filter((group) => group.namespace !== namespace),
    );
  };

  const addRule = (namespace: string) =>
    setRules(namespace, [
      ...(groupFor(namespace)?.filters ?? []),
      { field: 'name', operator: 'contains', value: '' },
    ]);

  const updateRule = (namespace: string, ruleIndex: number, patch: Partial<NodeFilter>) =>
    setRules(
      namespace,
      (groupFor(namespace)?.filters ?? []).map((filter, i) =>
        i === ruleIndex ? { ...filter, ...patch } : filter,
      ),
    );

  const removeRule = (namespace: string, ruleIndex: number) =>
    setRules(
      namespace,
      (groupFor(namespace)?.filters ?? []).filter((_, i) => i !== ruleIndex),
    );

  const renderRules = (namespace: string) => {
    const rules = groupFor(namespace)?.filters ?? [];
    return (
      <>
        {rules.length > 0 && (
          <ul className="query-rules">
            {rules.map((filter, ruleIndex) => (
              <li className="query-rule" key={ruleIndex}>
                <FilterSelect
                  label="Field"
                  className="query-field"
                  value={filter.field}
                  onChange={(value) =>
                    updateRule(namespace, ruleIndex, { field: value as FilterField })
                  }
                  options={FILTER_FIELD_OPTIONS.map(
                    (option): [string, string] => [option.value, option.label],
                  )}
                />
                <FilterSelect
                  label="Operator"
                  className="query-operator"
                  value={filter.operator}
                  onChange={(value) =>
                    updateRule(namespace, ruleIndex, { operator: value as FilterOperator })
                  }
                  options={FILTER_OPERATOR_OPTIONS.map(
                    (option): [string, string] => [option.value, option.label],
                  )}
                />
                <Field.Root className="field grow">
                  <Field.Label>Value</Field.Label>
                  <Input
                    value={filter.value}
                    disabled={!filterNeedsValue(filter.operator)}
                    placeholder={
                      filter.operator === 'matches'
                        ? 'Regular expression, e.g. ^daily_'
                        : 'Value or pattern'
                    }
                    onChange={(event) =>
                      updateRule(namespace, ruleIndex, { value: event.target.value })
                    }
                  />
                </Field.Root>
                <Button
                  className="icon-btn"
                  type="button"
                  onClick={() => removeRule(namespace, ruleIndex)}
                  aria-label={`Remove ${filter.field} filter from ${namespace}`}
                  title="Remove filter"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          className="btn small query-add-rule"
          type="button"
          onClick={() => addRule(namespace)}
        >
          <Plus size={14} aria-hidden="true" />
          Add filter
        </Button>
      </>
    );
  };

  return (
    <Accordion.Root
      className="query-editor"
      value={open ? ['namespace-filters'] : []}
      onValueChange={(value) => setOpen(value.includes('namespace-filters'))}
      multiple={false}
    >
      <Accordion.Item value="namespace-filters" className="query-editor-item">
        <Accordion.Header className="query-editor-header">
          <Accordion.Trigger className="query-editor-trigger">
            <span className="query-editor-trigger-title">
              <ListFilter size={16} aria-hidden="true" />
              Namespace filters
            </span>
            <span className="query-editor-summary">
              {total > 0
                ? `${total} ${total === 1 ? 'filter' : 'filters'}`
                : 'no filters'}
            </span>
            <ChevronDown size={16} className="query-editor-caret" aria-hidden="true" />
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel className="query-editor-panel">
          <div className="query-editor-body">
            {tabNamespaces.length === 0 ? (
              <p className="muted small query-editor-empty">No namespaces available.</p>
            ) : (
              <div className="namespace-editor">
                <Tabs.Root
                  orientation="vertical"
                  className="namespace-tabs"
                  value={currentNamespace}
                  onValueChange={(value) => {
                    if (typeof value === 'string' && value) setActiveNamespace(value);
                  }}
                >
                  <Tabs.List className="namespace-tab-list" aria-label="Namespace tabs">
                    {tabNamespaces.map((namespace) => {
                      const count = groupFor(namespace)?.filters.length ?? 0;
                      return (
                        <Tabs.Tab
                          key={namespace}
                          value={namespace}
                          className="namespace-tab"
                          aria-label={
                            count > 0
                              ? `${namespace}, ${count} ${count === 1 ? 'filter' : 'filters'}`
                              : `${namespace}, no filters`
                          }
                        >
                          <span className="mono namespace-tab-name">{namespace}</span>
                          {count > 0 && (
                            <span className="namespace-tab-badge" aria-hidden="true">
                              {count}
                            </span>
                          )}
                        </Tabs.Tab>
                      );
                    })}
                  </Tabs.List>
                  {tabNamespaces.map((namespace) => {
                    const count = groupFor(namespace)?.filters.length ?? 0;
                    return (
                      <Tabs.Panel
                        key={namespace}
                        value={namespace}
                        className="namespace-panel"
                      >
                        <div className="namespace-panel-head">
                          <span className={count > 0 ? 'query-count' : 'muted small'}>
                            {count > 0
                              ? `${count} ${count === 1 ? 'filter' : 'filters'}`
                              : 'No filters set'}
                          </span>
                        </div>
                        {renderRules(namespace)}
                      </Tabs.Panel>
                    );
                  })}
                </Tabs.Root>
              </div>
            )}
          </div>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
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
  const { q, type, archetype, filterSet } = useSearch({ from: '/nodes' });
  const navigate = useNavigate({ from: '/nodes' });
  const { graph, error, loading } = useGraph();
  const savedSets = useFilterSets();
  const activeSet = useMemo(
    () => savedSets.find((set) => set.id === filterSet) ?? null,
    [savedSets, filterSet],
  );

  const [filters, setFilters] = useState<NamespaceFilterGroup[]>(
    Array.isArray(activeSet?.filters) ? activeSet.filters : [],
  );
  const [namespaces, setNamespaces] = useState<string[]>(
    Array.isArray(activeSet?.namespaces) ? activeSet.namespaces : [],
  );
  const [loadedSetId, setLoadedSetId] = useState(activeSet?.id ?? '');

  const update = useCallback(
    (patch: Partial<NodesSearch>) =>
      navigate({ search: (prev) => ({ ...(prev as NodesSearch), ...patch }) }),
    [navigate],
  );

  // Load the editor state when a different saved set becomes active.
  const activeSetId = activeSet?.id ?? '';
  useEffect(() => {
    // Wait for local storage to resolve a newly selected set.
    if (filterSet && !activeSet) return;
    setFilters(Array.isArray(activeSet?.filters) ? activeSet.filters : []);
    setNamespaces(Array.isArray(activeSet?.namespaces) ? activeSet.namespaces : []);
    setLoadedSetId(activeSet?.id ?? '');
  }, [activeSetId, filterSet]);

  // Persist editor changes to the active set; URL only carries the set ID.
  useEffect(() => {
    if (!filterSet || !activeSet) return;
    // Ignore the render where a newly loaded set has not reached local state yet.
    if (loadedSetId !== activeSet.id) return;
    if (
      filtersSignature(activeSet.filters) === filtersSignature(filters) &&
      namespaceSelectionSignature(activeSet.namespaces) ===
        namespaceSelectionSignature(namespaces)
    ) {
      return;
    }
    updateFilterSet(activeSet.id, { filters, namespaces });
  }, [filterSet, activeSet, loadedSetId, filters, namespaces]);

  // The first non-empty edit gets an automatically saved Untitled set.
  useEffect(() => {
    if (filterSet) return;
    // Do not recreate a set while local state still belongs to the set that
    // just got cleared or deleted.
    if (loadedSetId !== '') return;
    if (filters.length === 0 && namespaces.length === 0) return;
    const set = createFilterSet('Untitled filter set', namespaces, filters);
    update({ filterSet: set.id });
  }, [filterSet, loadedSetId, filters, namespaces, update]);

  const availableNamespaces = useMemo(
    () => (graph ? [...new Set(graph.nodes.map((n) => n.namespace))].sort() : []),
    [graph],
  );
  const namespaceOptions = useMemo(
    () => [...new Set([...availableNamespaces, ...namespaces])].sort(),
    [availableNamespaces, namespaces],
  );

  const archetypes = useMemo(
    () =>
      graph
        ? [...new Set(graph.nodes.map((n) => n.archetype).filter((a): a is string => a != null))].sort()
        : [],
    [graph],
  );

  const [focusedNamespace, setFocusedNamespace] = useState<string | null>(null);

  const nodes = useMemo(() => {
    if (!graph) return [];
    const term = q.trim().toLowerCase();
    return graph.nodes
      .filter((n) => namespaces.length === 0 || namespaces.includes(n.namespace))
      .filter((n) => focusedNamespace === null || n.namespace === focusedNamespace)
      .filter((n) => type === 'all' || n.type === type)
      .filter((n) => archetype === 'all' || n.archetype === archetype)
      .filter((n) => nodeMatchesFilters(n, filters))
      .filter((n) => {
        if (!term) return true;
        return [n.name, n.namespace, n.title ?? '', n.description ?? '', n.archetype ?? ''].some((v) =>
          v.toLowerCase().includes(term),
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.namespace.localeCompare(b.namespace));
  }, [graph, q, type, archetype, namespaces, focusedNamespace, filters]);

  const hasFilters =
    q !== '' ||
    type !== 'all' ||
    archetype !== 'all' ||
    namespaces.length > 0 ||
    filterSet !== '' ||
    hasActiveFilters(filters);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  // Only count selections that match the current filters; hidden rows should not
  // end up pinned by a button the user cannot reconcile with the table.
  const selectedNodes = useMemo(() => nodes.filter((n) => selectedSet.has(n.id)), [nodes, selectedSet]);

  const selectRow = useCallback((event: MouseEvent<HTMLTableRowElement>, id: string) => {
    // Let links, buttons, and other controls inside the row handle their own clicks.
    if ((event.target as HTMLElement).closest('a, button, input, select, textarea')) return;
    const additive = event.ctrlKey || event.metaKey;
    setSelectedIds((prev) => {
      if (!additive) return prev.length === 1 && prev[0] === id ? [] : [id];
      return prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id];
    });
  }, []);

  const selectAll = useCallback(() => setSelectedIds(nodes.map((n) => n.id)), [nodes]);

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
        <Field.Root className="field namespace-field">
          <Field.Label>Namespaces</Field.Label>
          <NamespacePicker
            namespaces={namespaceOptions}
            selected={namespaces}
            onChange={setNamespaces}
          />
        </Field.Root>
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
          onClick={() => {
            setFilters([]);
            setNamespaces([]);
            update({ q: '', type: 'all', archetype: 'all', filterSet: '' });
          }}
          disabled={!hasFilters}
        >
          <X size={15} aria-hidden="true" />
          Clear
        </Button>
      </form>

      <QueryEditor
        namespaces={availableNamespaces}
        selectedNamespaces={namespaces}
        groups={filters}
        onChange={setFilters}
        onNamespaceFocus={setFocusedNamespace}
      />

      {error && (
        <div className="banner error inline" role="alert">
          Could not load the lineage graph: {error}.
        </div>
      )}
      {!error && loading && <p className="muted nodes-status">Loading…</p>}
      {!error && !loading && graph && (
        <>
          <div className="nodes-toolbar">
            <p className="muted nodes-status">
              {nodes.length} of {graph.nodes.length} nodes
              {selectedNodes.length > 0 && ` · ${selectedNodes.length} selected`}
            </p>
            <div className="selection-actions">
              <Button
                className="btn small"
                type="button"
                onClick={selectAll}
                disabled={nodes.length === 0 || selectedNodes.length === nodes.length}
              >
                <Check size={14} aria-hidden="true" />
                Select all
              </Button>
              {selectedNodes.length > 0 && (
                <>
                  <Button className="btn small" type="button" onClick={() => setSelectedIds([])}>
                    <X size={14} aria-hidden="true" />
                    Clear selection
                  </Button>
                  {selectedNodes.length > 1 && (
                    <Link
                      to="/"
                      search={{
                        pinned: selectedNodes.map((n) => n.id),
                        selected: '',
                        filterSet,
                      }}
                      className="btn small primary"
                    >
                      <Pin size={14} aria-hidden="true" />
                      View graph with the selected nodes pinned
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
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
                  <tr
                    key={n.id}
                    className={selectedSet.has(n.id) ? 'selectable selected' : 'selectable'}
                    aria-selected={selectedSet.has(n.id)}
                    onClick={(event) => selectRow(event, n.id)}
                  >
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
                        search={{
                          selected: n.id,
                          filterSet,
                        }}
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
