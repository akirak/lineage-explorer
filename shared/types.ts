export type JobNode = {
  id: string;
  type: 'job';
  namespace: string;
  name: string;
  title: string | null;
  description: string | null;
  archetype: string | null;
};

export type DatasetField = {
  name: string;
  type: string | null;
  description: string | null;
};

export type DatasetNode = {
  id: string;
  type: 'dataset';
  namespace: string;
  name: string;
  title: string | null;
  description: string | null;
  archetype: string | null;
  fields: DatasetField[];
};

export type LineageNode = JobNode | DatasetNode;

/** Create/update/delete marker for a job's output dataset (job_output.crud). */
export type Crud = 'C' | 'U' | 'D';

/** Table-level edge: dataset -> job (input) or job -> dataset (output). */
export type LineageEdge = {
  id: string;
  source: string;
  target: string;
  /** 'io' for job input/output edges, 'view' for a view over a table in the same database. */
  kind: 'io' | 'view';
  /** C, U or D from the optional job_output.crud column; null for input and view edges. */
  crud: Crud | null;
};

/** Column-level edge from an input field to an output field (OpenLineage columnLineage facet). */
export type ColumnEdge = {
  id: string;
  source: string;
  sourceField: string;
  target: string;
  targetField: string;
  /** Job that produces the output field, if known. */
  job: string | null;
  /** DIRECT or INDIRECT. */
  transformationType: string | null;
  /** IDENTITY, TRANSFORMATION, AGGREGATION, JOIN, FILTER, ... */
  transformationSubtype: string | null;
  /** Optional human-friendly note about this column-level edge. */
  description: string | null;
};

export type Graph = {
  nodes: LineageNode[];
  edges: LineageEdge[];
  columnEdges: ColumnEdge[];
};
