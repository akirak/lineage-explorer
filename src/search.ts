import type { SearchSchemaInput } from '@tanstack/react-router';

export type Mode = 'table' | 'column';

/** Maximum lineage depth shown around the pinned nodes; 'all' disables the limit. */
export type LineageDegree = 'all' | '1' | '2' | '3' | '4';

/** Which side of the pinned nodes the degree filter covers. */
export type LineageDirection = 'all' | 'upstream' | 'downstream';

/** UI state kept in the URL query string so a view can be shared or reloaded. */
export type ExplorerSearch = {
  mode: Mode;
  /** Maximum number of upstream/downstream hops to show around each pinned node. */
  degree: LineageDegree;
  /** Restrict each pinned node's visible lineage to upstream or downstream nodes. */
  direction: LineageDirection;
  /** Selected node id, or a column key (`<datasetId>\u0001<field>`); empty when nothing is selected. */
  selected: string;
  /** Node ids pinned to the graph viewport; empty when nothing is pinned. */
  pinned: string[];
  isolate: boolean;
  /** ID of the locally saved filter set that supplies the namespaces and filters. */
  filterSet: string;
};

/** Navigation may omit any field; defaults fill the gaps. */
export type ExplorerSearchInput = Partial<ExplorerSearch> & SearchSchemaInput;

export const defaultSearch: ExplorerSearch = {
  mode: 'table',
  degree: 'all',
  direction: 'all',
  selected: '',
  pinned: [],
  isolate: false,
  filterSet: '',
};

function parsePinned(search: ExplorerSearchInput): string[] {
  const raw = search.pinned;
  const values = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  // Older links stored a single node id as a plain string, so accept both forms.
  return [...new Set(values.filter((id): id is string => typeof id === 'string' && id !== ''))];
}

export function parseSearch(search: ExplorerSearchInput): ExplorerSearch {
  const degree = search.degree;
  const direction = search.direction;
  return {
    mode: search.mode === 'column' ? 'column' : 'table',
    degree: degree === '1' || degree === '2' || degree === '3' || degree === '4' ? degree : 'all',
    direction: direction === 'upstream' || direction === 'downstream' ? direction : 'all',
    selected: typeof search.selected === 'string' ? search.selected : '',
    pinned: parsePinned(search),
    isolate: search.isolate === true || String(search.isolate) === 'true',
    filterSet: typeof search.filterSet === 'string' ? search.filterSet : '',
  };
}

export type NodeTypeFilter = 'all' | 'job' | 'dataset';

/** Filters for the node table, also kept in the URL so a filtered list can be shared. */
export type NodesSearch = {
  q: string;
  type: NodeTypeFilter;
  archetype: string;
  /** ID of the locally saved filter set that supplies the namespaces and filters. */
  filterSet: string;
};

export type NodesSearchInput = Partial<NodesSearch> & SearchSchemaInput;

export const defaultNodesSearch: NodesSearch = {
  q: '',
  type: 'all',
  archetype: 'all',
  filterSet: '',
};

export function parseNodesSearch(search: NodesSearchInput): NodesSearch {
  const type = search.type;
  return {
    q: typeof search.q === 'string' ? search.q : '',
    type: type === 'job' || type === 'dataset' ? type : 'all',
    archetype: typeof search.archetype === 'string' && search.archetype ? search.archetype : 'all',
    filterSet: typeof search.filterSet === 'string' ? search.filterSet : '',
  };
}
