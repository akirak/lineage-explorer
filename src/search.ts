import type { SearchSchemaInput } from '@tanstack/react-router';

export type Mode = 'table' | 'column';

/** UI state kept in the URL query string so a view can be shared or reloaded. */
export type ExplorerSearch = {
  mode: Mode;
  /** Namespaces to show; empty means all namespaces. */
  namespaces: string[];
  /** Selected node id, or a column key (`<datasetId>\u0001<field>`); empty when nothing is selected. */
  selected: string;
  isolate: boolean;
};

/** Navigation may omit any field; defaults fill the gaps. */
export type ExplorerSearchInput = Partial<ExplorerSearch> & {
  /** Legacy single-namespace parameter, still accepted from older links. */
  namespace?: unknown;
} & SearchSchemaInput;

export const defaultSearch: ExplorerSearch = {
  mode: 'table',
  namespaces: [],
  selected: '',
  isolate: false,
};

function parseNamespaces(search: ExplorerSearchInput): string[] {
  const raw = search.namespaces;
  const values = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const picked = values.filter((n): n is string => typeof n === 'string' && n !== '' && n !== 'all');
  if (picked.length > 0) return [...new Set(picked)];
  // Backwards compatibility with the old single-namespace parameter.
  const legacy = search.namespace;
  return typeof legacy === 'string' && legacy !== '' && legacy !== 'all' ? [legacy] : [];
}

export function parseSearch(search: ExplorerSearchInput): ExplorerSearch {
  return {
    mode: search.mode === 'column' ? 'column' : 'table',
    namespaces: parseNamespaces(search),
    selected: typeof search.selected === 'string' ? search.selected : '',
    isolate: search.isolate === true || String(search.isolate) === 'true',
  };
}

export type NodeTypeFilter = 'all' | 'job' | 'dataset';

/** Filters for the node table, also kept in the URL so a filtered list can be shared. */
export type NodesSearch = {
  q: string;
  namespace: string;
  type: NodeTypeFilter;
  archetype: string;
};

export type NodesSearchInput = Partial<NodesSearch> & SearchSchemaInput;

export const defaultNodesSearch: NodesSearch = {
  q: '',
  namespace: 'all',
  type: 'all',
  archetype: 'all',
};

export function parseNodesSearch(search: NodesSearchInput): NodesSearch {
  const type = search.type;
  return {
    q: typeof search.q === 'string' ? search.q : '',
    namespace: typeof search.namespace === 'string' && search.namespace ? search.namespace : 'all',
    type: type === 'job' || type === 'dataset' ? type : 'all',
    archetype: typeof search.archetype === 'string' && search.archetype ? search.archetype : 'all',
  };
}
