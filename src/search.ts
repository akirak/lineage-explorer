import type { SearchSchemaInput } from '@tanstack/react-router';

export type Mode = 'table' | 'column';

/** UI state kept in the URL query string so a view can be shared or reloaded. */
export type ExplorerSearch = {
  mode: Mode;
  namespace: string;
  /** Selected node id, or a column key (`<datasetId>\u0001<field>`); empty when nothing is selected. */
  selected: string;
  isolate: boolean;
};

/** Navigation may omit any field; defaults fill the gaps. */
export type ExplorerSearchInput = Partial<ExplorerSearch> & SearchSchemaInput;

export const defaultSearch: ExplorerSearch = {
  mode: 'table',
  namespace: 'all',
  selected: '',
  isolate: false,
};

export function parseSearch(search: ExplorerSearchInput): ExplorerSearch {
  return {
    mode: search.mode === 'column' ? 'column' : 'table',
    namespace: typeof search.namespace === 'string' && search.namespace ? search.namespace : 'all',
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
