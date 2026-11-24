import type { SearchSchemaInput } from '@tanstack/react-router';

// ---------------------------------------------------------------------------
// Common search parameters
//
// The Graph and Nodes views filter the same set of nodes, so they share the
// parameters below. Keeping the keys and parsing in one place lets navigation
// carry the active filter between the two routes and keeps shared links
// consistent.
// ---------------------------------------------------------------------------

/** Parameters shared by the Graph and Nodes views. */
export type CommonSearch = {
  /** Namespaces to show; empty means all namespaces. */
  namespaces: string[];
};

/** Navigation may omit any common field; defaults fill the gaps. */
export type CommonSearchInput = Partial<CommonSearch> & {
  /** Legacy single-namespace parameter, still accepted from older links. */
  namespace?: unknown;
} & SearchSchemaInput;

export const defaultCommonSearch: CommonSearch = {
  namespaces: [],
};

function parseNamespaces(search: CommonSearchInput): string[] {
  const raw = search.namespaces;
  const values = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const picked = values.filter((n): n is string => typeof n === 'string' && n !== '' && n !== 'all');
  if (picked.length > 0) return [...new Set(picked)];
  // Backwards compatibility with the old single-namespace parameter.
  const legacy = search.namespace;
  return typeof legacy === 'string' && legacy !== '' && legacy !== 'all' ? [legacy] : [];
}

export function parseCommonSearch(search: CommonSearchInput): CommonSearch {
  return { namespaces: parseNamespaces(search) };
}

export type Mode = 'table' | 'column';

/** Maximum lineage depth shown around the pinned nodes; 'all' disables the limit. */
export type LineageDegree = 'all' | '1' | '2' | '3' | '4';

/** Which side of the pinned nodes the degree filter covers. */
export type LineageDirection = 'all' | 'upstream' | 'downstream';

/** UI state kept in the URL query string so a view can be shared or reloaded. */
export type ExplorerSearch = CommonSearch & {
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
};

/** Navigation may omit any field; defaults fill the gaps. */
export type ExplorerSearchInput = Partial<ExplorerSearch> & {
  /** Legacy single-namespace parameter, still accepted from older links. */
  namespace?: unknown;
} & SearchSchemaInput;

export const defaultSearch: ExplorerSearch = {
  ...defaultCommonSearch,
  mode: 'table',
  degree: 'all',
  direction: 'all',
  selected: '',
  pinned: [],
  isolate: false,
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
    ...parseCommonSearch(search),
    mode: search.mode === 'column' ? 'column' : 'table',
    degree: degree === '1' || degree === '2' || degree === '3' || degree === '4' ? degree : 'all',
    direction: direction === 'upstream' || direction === 'downstream' ? direction : 'all',
    selected: typeof search.selected === 'string' ? search.selected : '',
    pinned: parsePinned(search),
    isolate: search.isolate === true || String(search.isolate) === 'true',
  };
}

export type NodeTypeFilter = 'all' | 'job' | 'dataset';

/** Filters for the node table, also kept in the URL so a filtered list can be shared. */
export type NodesSearch = CommonSearch & {
  q: string;
  type: NodeTypeFilter;
  archetype: string;
};

export type NodesSearchInput = Partial<NodesSearch> & {
  /** Legacy single-namespace parameter, still accepted from older links. */
  namespace?: unknown;
} & SearchSchemaInput;

export const defaultNodesSearch: NodesSearch = {
  ...defaultCommonSearch,
  q: '',
  type: 'all',
  archetype: 'all',
};

export function parseNodesSearch(search: NodesSearchInput): NodesSearch {
  const type = search.type;
  return {
    ...parseCommonSearch(search),
    q: typeof search.q === 'string' ? search.q : '',
    type: type === 'job' || type === 'dataset' ? type : 'all',
    archetype: typeof search.archetype === 'string' && search.archetype ? search.archetype : 'all',
  };
}
