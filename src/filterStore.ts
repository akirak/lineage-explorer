import { useCallback, useEffect, useState } from 'react';
import { parseFilterGroups, type NamespaceFilterGroup } from './filters.ts';

/** A named, locally persisted set of per-namespace query filters. */
export type SavedFilterSet = {
  id: string;
  name: string;
  /** Namespaces chosen for the view; empty means all namespaces. */
  namespaces: string[];
  filters: NamespaceFilterGroup[];
  createdAt: number;
  updatedAt: number;
};

const STORAGE_KEY = 'lineage-explorer.filter-sets.v1';
const CHANGE_EVENT = 'lineage-explorer:filter-sets';

const cloneFilters = (groups: NamespaceFilterGroup[]): NamespaceFilterGroup[] =>
  groups.map((group) => ({
    namespace: group.namespace,
    filters: group.filters.map((filter) => ({ ...filter })),
  }));

const normalizeNamespaces = (raw: unknown): string[] => {
  const values = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  return [
    ...new Set(
      values.filter((namespace): namespace is string =>
        typeof namespace === 'string' && namespace !== '' && namespace !== 'all',
      ),
    ),
  ];
};

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Private browsing and blocked storage must not break the rest of the app.
    return null;
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toSavedFilterSet(raw: unknown): SavedFilterSet | null {
  if (raw == null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!id || !name) return null;
  const createdAt =
    typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0;
  const updatedAt =
    typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt;
  return {
    id,
    name,
    namespaces: normalizeNamespaces(record.namespaces),
    filters: parseFilterGroups(record.filters),
    createdAt,
    updatedAt,
  };
}

/** Reads and normalizes every saved filter set, newest first. */
export function readFilterSets(): SavedFilterSet[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const byId = new Map<string, SavedFilterSet>();
    for (const item of parsed) {
      const set = toSavedFilterSet(item);
      if (set && !byId.has(set.id)) byId.set(set.id, set);
    }
    return [...byId.values()].sort(
      (a, b) =>
        b.updatedAt - a.updatedAt || (a.name ?? '').localeCompare(b.name ?? ''),
    );
  } catch {
    // Corrupt or unavailable storage should behave like an empty collection.
    return [];
  }
}

function writeFilterSets(sets: SavedFilterSet[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(sets));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Ignore quota and serialization failures; the URL still holds the filters.
  }
}

/** Looks a saved filter set up by its stable ID. */
export function getFilterSet(id: string): SavedFilterSet | null {
  if (!id) return null;
  return readFilterSets().find((set) => set.id === id) ?? null;
}

export function createFilterSet(
  name: string,
  namespaces: string[],
  filters: NamespaceFilterGroup[],
): SavedFilterSet {
  const sets = readFilterSets();
  const used = new Set(sets.map((set) => set.id));
  let id = newId();
  while (used.has(id)) id = newId();
  const now = Date.now();
  const set: SavedFilterSet = {
    id,
    name: name.trim() || 'Untitled filter set',
    namespaces: normalizeNamespaces(namespaces),
    filters: cloneFilters(filters),
    createdAt: now,
    updatedAt: now,
  };
  writeFilterSets([set, ...sets]);
  return set;
}

export type FilterSetPatch = {
  name?: string;
  namespaces?: string[];
  filters?: NamespaceFilterGroup[];
};

export function updateFilterSet(id: string, patch: FilterSetPatch): SavedFilterSet | null {
  const sets = readFilterSets();
  const index = sets.findIndex((set) => set.id === id);
  if (index < 0) return null;
  const current = sets[index];
  const updated: SavedFilterSet = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name.trim() || current.name } : {}),
    ...(patch.namespaces !== undefined
      ? { namespaces: normalizeNamespaces(patch.namespaces) }
      : {}),
    ...(patch.filters !== undefined ? { filters: cloneFilters(patch.filters) } : {}),
    updatedAt: Date.now(),
  };
  sets[index] = updated;
  writeFilterSets(sets);
  return updated;
}

export function deleteFilterSet(id: string): void {
  const sets = readFilterSets();
  const next = sets.filter((set) => set.id !== id);
  if (next.length !== sets.length) writeFilterSets(next);
}

export function subscribeFilterSets(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key == null || event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

/** Saved filter sets, refreshed when this tab or another tab changes them. */
export function useFilterSets(): SavedFilterSet[] {
  const [sets, setSets] = useState<SavedFilterSet[]>([]);
  const refresh = useCallback(() => setSets(readFilterSets()), []);
  useEffect(() => {
    // Start empty so server rendering and hydration agree, then load storage.
    refresh();
    return subscribeFilterSets(refresh);
  }, [refresh]);
  return sets;
}
