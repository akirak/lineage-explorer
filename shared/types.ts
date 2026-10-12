export type JobNode = {
  id: string;
  type: 'job';
  namespace: string;
  name: string;
  state: string | null;
  lastEventTime: string | null;
};

export type DatasetNode = {
  id: string;
  type: 'dataset';
  namespace: string;
  name: string;
};

export type LineageNode = JobNode | DatasetNode;

export type LineageEdge = {
  id: string;
  source: string;
  target: string;
};

export type Graph = {
  nodes: LineageNode[];
  edges: LineageEdge[];
};

export type JobRun = {
  run_id: string;
  parent_run_id: string | null;
  state: string | null;
  started_at: string | null;
  last_event_at: string | null;
  duration_ms: number | string | null;
};

export type ApiError = {
  error: string;
};
