export type Mode = 'table' | 'column';

/** UI state kept in the URL query string so a view can be shared or reloaded. */
export type ExplorerSearch = {
  mode: Mode;
  namespace: string;
  /** Selected node id, or a column key (`<datasetId>\u0001<field>`); empty when nothing is selected. */
  selected: string;
  isolate: boolean;
};

export const defaultSearch: ExplorerSearch = {
  mode: 'table',
  namespace: 'all',
  selected: '',
  isolate: false,
};

export function parseSearch(search: Record<string, unknown>): ExplorerSearch {
  return {
    mode: search.mode === 'column' ? 'column' : 'table',
    namespace: typeof search.namespace === 'string' && search.namespace ? search.namespace : 'all',
    selected: typeof search.selected === 'string' ? search.selected : '',
    isolate: search.isolate === true || search.isolate === 'true',
  };
}
