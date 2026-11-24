import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { Button } from '@base-ui-components/react/button';
import { Dialog } from '@base-ui-components/react/dialog';
import { Field } from '@base-ui-components/react/field';
import { Input } from '@base-ui-components/react/input';
import { Copy, Network, Pencil, Rows3, X } from 'lucide-react';
import {
  createFilterSet,
  updateFilterSet,
  useFilterSets,
  type SavedFilterSet,
} from './filterStore.ts';
import FilterSelect from './FilterSelect.tsx';

const NO_FILTER_SET = '__no_filter_set__';

type FilterSetDialog = 'rename' | 'duplicate' | null;

/** Global navigation shared by every page. */
export default function SiteHeader() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const savedSets = useFilterSets();
  const [dialogMode, setDialogMode] = useState<FilterSetDialog>(null);
  const [draftName, setDraftName] = useState('');
  const isNodesView = pathname === '/nodes';

  const filterSetId = typeof search.filterSet === 'string' ? search.filterSet : '';
  const activeSet = useMemo(
    () => savedSets.find((set) => set.id === filterSetId) ?? null,
    [savedSets, filterSetId],
  );

  const updateSearch = useCallback(
    (patch: Record<string, unknown>) =>
      navigate({
        to: pathname,
        search: (prev) => ({ ...(prev as Record<string, unknown>), ...patch }),
      }),
    [navigate, pathname],
  );

  useEffect(() => {
    if (!isNodesView) setDialogMode(null);
  }, [isNodesView]);

  const loadFilterSet = (set: SavedFilterSet) => updateSearch({ filterSet: set.id });

  const openRename = () => {
    if (!activeSet) return;
    setDraftName(activeSet.name);
    setDialogMode('rename');
  };

  const openDuplicate = () => {
    if (!activeSet) return;
    setDraftName(`${activeSet.name} copy`);
    setDialogMode('duplicate');
  };

  const commitDialog = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (dialogMode === 'rename' && activeSet) {
      updateFilterSet(activeSet.id, { name: draftName.trim() || activeSet.name });
    } else if (dialogMode === 'duplicate' && activeSet) {
      const set = createFilterSet(draftName, activeSet.namespaces, activeSet.filters);
      updateSearch({ filterSet: set.id });
    }
    setDialogMode(null);
  };

  const clearFilters = () => updateSearch({ filterSet: '' });

  // Only the saved filter set ID travels between the Nodes and Graph views.
  const carriedSearch = filterSetId ? { filterSet: filterSetId } : {};

  return (
    <header className="topbar">
      <h1>Lineage explorer</h1>
      <nav className="nav" aria-label="Views">
        <Link
          to="/"
          search={carriedSearch}
          className="nav-link"
          activeProps={{ className: 'on' }}
          activeOptions={{ exact: true }}
        >
          <Network size={16} aria-hidden="true" />
          Graph
        </Link>
        <Link to="/nodes" search={carriedSearch} className="nav-link" activeProps={{ className: 'on' }}>
          <Rows3 size={16} aria-hidden="true" />
          Nodes
        </Link>
      </nav>

      <div className="filter-set-bar">
        <FilterSelect
          label="Filter set"
          hideLabel
          className="header-filter-set"
          value={filterSetId || NO_FILTER_SET}
          onChange={(value) => {
            if (value === NO_FILTER_SET) {
              updateSearch({ filterSet: '' });
              return;
            }
            const set = savedSets.find((candidate) => candidate.id === value);
            if (set) loadFilterSet(set);
          }}
          options={[
            [NO_FILTER_SET, savedSets.length > 0 ? 'No saved filter set' : 'No saved sets yet'],
            ...savedSets.map((set): [string, string] => [set.id, set.name]),
          ]}
        />
        {isNodesView && (
          <Dialog.Root
            open={dialogMode != null}
            onOpenChange={(open) => {
              if (!open) setDialogMode(null);
            }}
          >
            <Button
              className="btn small"
              type="button"
              onClick={openRename}
              disabled={!activeSet}
              title="Rename the active filter set"
            >
              <Pencil size={14} aria-hidden="true" />
              Rename
            </Button>
            <Button
              className="btn small"
              type="button"
              onClick={openDuplicate}
              disabled={!activeSet}
              title="Duplicate the active filter set with a new name"
            >
              <Copy size={14} aria-hidden="true" />
              Duplicate
            </Button>
            <Dialog.Portal>
              <Dialog.Backdrop className="modal-backdrop" />
              <Dialog.Viewport className="modal-viewport">
                <Dialog.Popup className="modal">
                  <form onSubmit={commitDialog}>
                    <Dialog.Title className="modal-title">
                      {dialogMode === 'rename' ? 'Rename filter set' : 'Duplicate filter set'}
                    </Dialog.Title>
                    <Dialog.Description className="modal-description">
                      {dialogMode === 'rename'
                        ? 'Enter a new name for this filter set.'
                        : 'Enter a name for the new filter set.'}
                    </Dialog.Description>
                    <Field.Root className="field">
                      <Field.Label>Name</Field.Label>
                      <Input
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        placeholder="Untitled filter set"
                        autoFocus
                      />
                    </Field.Root>
                    <div className="modal-actions">
                      <Dialog.Close className="btn" type="button">
                        Cancel
                      </Dialog.Close>
                      <Button className="btn primary" type="submit">
                        {dialogMode === 'rename' ? 'Rename' : 'Duplicate'}
                      </Button>
                    </div>
                  </form>
                </Dialog.Popup>
              </Dialog.Viewport>
            </Dialog.Portal>
          </Dialog.Root>
        )}
        <Button
          className="btn small"
          type="button"
          onClick={clearFilters}
          disabled={!activeSet && !filterSetId}
          title="Clear the active filter set"
        >
          <X size={14} aria-hidden="true" />
          Clear
        </Button>
      </div>
    </header>
  );
}
