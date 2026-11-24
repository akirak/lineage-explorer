import type { LineageNode } from '../shared/types.ts';

/** Node attributes that can be matched by a per-namespace filter. */
export type FilterField = 'name' | 'type' | 'archetype' | 'title' | 'description' | 'column';

/** Predicates available for each filter. */
export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'matches'
  | 'isEmpty'
  | 'isNotEmpty';

/** One field/operator/value rule inside a namespace filter group. */
export type NodeFilter = {
  field: FilterField;
  operator: FilterOperator;
  /** Literal text, substring, or regular expression, depending on the operator. */
  value: string;
};

/**
 * A set of rules that only applies to nodes from one namespace. Every rule in
 * a group must match (logical AND). Nodes from other namespaces are unaffected.
 */
export type NamespaceFilterGroup = {
  namespace: string;
  filters: NodeFilter[];
};

export const FILTER_FIELD_OPTIONS: { value: FilterField; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'type', label: 'Type' },
  { value: 'archetype', label: 'Archetype' },
  { value: 'title', label: 'Title' },
  { value: 'description', label: 'Description' },
  { value: 'column', label: 'Column name' },
];

export const FILTER_OPERATOR_OPTIONS: {
  value: FilterOperator;
  label: string;
  needsValue: boolean;
}[] = [
  { value: 'equals', label: 'is', needsValue: true },
  { value: 'notEquals', label: 'is not', needsValue: true },
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'notContains', label: 'does not contain', needsValue: true },
  { value: 'startsWith', label: 'starts with', needsValue: true },
  { value: 'endsWith', label: 'ends with', needsValue: true },
  { value: 'matches', label: 'matches regex', needsValue: true },
  { value: 'isEmpty', label: 'is empty', needsValue: false },
  { value: 'isNotEmpty', label: 'is not empty', needsValue: false },
];

const FILTER_FIELDS = new Set<string>(FILTER_FIELD_OPTIONS.map((option) => option.value));
const FILTER_OPERATORS = new Set<string>(FILTER_OPERATOR_OPTIONS.map((option) => option.value));
const OPERATORS_WITHOUT_VALUE = new Set<FilterOperator>(
  FILTER_OPERATOR_OPTIONS.filter((option) => !option.needsValue).map((option) => option.value),
);

export const filterFieldLabel = (field: FilterField) =>
  FILTER_FIELD_OPTIONS.find((option) => option.value === field)?.label ?? field;

export const filterOperatorLabel = (operator: FilterOperator) =>
  FILTER_OPERATOR_OPTIONS.find((option) => option.value === operator)?.label ?? operator;

export const filterNeedsValue = (operator: FilterOperator) => !OPERATORS_WITHOUT_VALUE.has(operator);

export const countFilters = (groups: NamespaceFilterGroup[]) =>
  groups.reduce((count, group) => count + group.filters.length, 0);

export const hasActiveFilters = (groups: NamespaceFilterGroup[]) => countFilters(groups) > 0;

/** Stable signature for comparing two filter group lists regardless of object identity. */
export const filtersSignature = (groups: NamespaceFilterGroup[]) =>
  JSON.stringify(
    groups.map((group) => [
      group.namespace,
      group.filters.map((filter) => [filter.field, filter.operator, filter.value]),
    ]),
  );

/** Stable signature for comparing namespace selections regardless of order. */
export const namespaceSelectionSignature = (namespaces: string[]) =>
  JSON.stringify([...new Set(namespaces)].sort());

/** Human-readable one-line description used for tooltips and the graph chip. */
export function describeFilter(filter: NodeFilter): string {
  const field = filterFieldLabel(filter.field);
  const operator = filterOperatorLabel(filter.operator);
  return filterNeedsValue(filter.operator) ? `${field} ${operator} ${filter.value}` : `${field} ${operator}`;
}

// ---- URL parsing -----------------------------------------------------------

function isFilterField(value: unknown): value is FilterField {
  return typeof value === 'string' && FILTER_FIELDS.has(value);
}

function isFilterOperator(value: unknown): value is FilterOperator {
  return typeof value === 'string' && FILTER_OPERATORS.has(value);
}

function parseNodeFilter(raw: unknown): NodeFilter | null {
  if (raw == null || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!isFilterField(record.field) || !isFilterOperator(record.operator)) return null;
  const value =
    typeof record.value === 'string'
      ? record.value
      : typeof record.value === 'number'
        ? String(record.value)
        : '';
  return { field: record.field, operator: record.operator, value };
}

/**
 * Normalizes the `filters` search parameter. Accepts an array of groups, a
 * single group, or a JSON string (older links); invalid entries are dropped.
 * Duplicate namespaces are merged into one group.
 */
export function parseFilterGroups(raw: unknown): NamespaceFilterGroup[] {
  let input = raw;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return [];
    }
  }
  if (input == null) return [];
  const list = Array.isArray(input) ? input : [input];
  const groups = new Map<string, NamespaceFilterGroup>();
  for (const item of list) {
    if (item == null || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const namespace = typeof record.namespace === 'string' ? record.namespace.trim() : '';
    if (!namespace) continue;
    const rawFilters = Array.isArray(record.filters) ? record.filters : [];
    const filters = rawFilters
      .map(parseNodeFilter)
      .filter((filter): filter is NodeFilter => filter != null);
    const existing = groups.get(namespace);
    if (existing) existing.filters.push(...filters);
    else groups.set(namespace, { namespace, filters });
  }
  return [...groups.values()];
}

// ---- Matching --------------------------------------------------------------

const normalize = (value: string) => value.toLowerCase();

/** Values a node exposes for a field; datasets have one value per column. */
export function filterValues(node: LineageNode, field: FilterField): string[] {
  switch (field) {
    case 'name':
      return [node.name];
    case 'type':
      return [node.type];
    case 'archetype':
      return [node.archetype ?? ''];
    case 'title':
      return [node.title ?? ''];
    case 'description':
      return [node.description ?? ''];
    case 'column':
      return node.type === 'dataset' ? node.fields.map((field) => field.name) : [];
  }
}

function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    // An invalid expression simply matches nothing rather than breaking the view.
    return null;
  }
}

function matchPositive(value: string, filter: NodeFilter): boolean {
  const actual = normalize(value);
  const expected = normalize(filter.value.trim());
  switch (filter.operator) {
    case 'equals':
      return actual === expected;
    case 'contains':
      return actual.includes(expected);
    case 'startsWith':
      return actual.startsWith(expected);
    case 'endsWith':
      return actual.endsWith(expected);
    case 'matches': {
      const pattern = compilePattern(filter.value);
      return pattern ? pattern.test(value) : false;
    }
    case 'isEmpty':
      return value.trim() === '';
    case 'isNotEmpty':
      return value.trim() !== '';
    case 'notEquals':
    case 'notContains':
      // Handled by nodeMatchesFilter so list-valued fields require every value
      // to miss the pattern.
      return false;
  }
}

export function nodeMatchesFilter(node: LineageNode, filter: NodeFilter): boolean {
  const values = filterValues(node, filter.field);
  switch (filter.operator) {
    case 'isEmpty':
      return values.every((value) => value.trim() === '');
    case 'isNotEmpty':
      return values.some((value) => value.trim() !== '');
    case 'notEquals':
      return values.every((value) => normalize(value) !== normalize(filter.value.trim()));
    case 'notContains':
      return values.every((value) => !normalize(value).includes(normalize(filter.value.trim())));
    default:
      return values.some((value) => matchPositive(value, filter));
  }
}

export function namespaceMatchesFilters(node: LineageNode, group: NamespaceFilterGroup): boolean {
  return group.filters.every((filter) => nodeMatchesFilter(node, filter));
}

/**
 * Nodes from a namespace with no filter group always pass. When several groups
 * target the same namespace (only possible from hand-written URLs), all of
 * them must match.
 */
export function nodeMatchesFilters(node: LineageNode, groups: NamespaceFilterGroup[]): boolean {
  return groups
    .filter((group) => group.namespace === node.namespace)
    .every((group) => namespaceMatchesFilters(node, group));
}
