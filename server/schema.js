// ---------------------------------------------------------------------------
// Schema mapping: the ONLY file you need to edit to match your DuckDB tables.
//
// Each OpenLineage entity type lives in its own table. Adjust the table and
// column names below to whatever your database uses.
//
//   job            one row per job            (namespace, name)
//   dataset        one row per dataset        (namespace, name)
//   run            one row per run            (run id, owning job, optional parent run)
//   run_event      one row per RunEvent       (run id, event time, event type)
//   input_dataset  datasets a run reads       (run id, dataset namespace + name)
//   output_dataset datasets a run writes      (run id, dataset namespace + name)
// ---------------------------------------------------------------------------
export const schema = {
  job: { table: 'job', namespace: 'namespace', name: 'name' },
  dataset: { table: 'dataset', namespace: 'namespace', name: 'name' },
  run: {
    table: 'run',
    id: 'run_id',
    jobNamespace: 'job_namespace',
    jobName: 'job_name',
    parentId: 'parent_run_id',
  },
  runEvent: { table: 'run_event', runId: 'run_id', time: 'event_time', type: 'event_type' },
  input: { table: 'input_dataset', runId: 'run_id', namespace: 'dataset_namespace', name: 'dataset_name' },
  output: { table: 'output_dataset', runId: 'run_id', namespace: 'dataset_namespace', name: 'dataset_name' },
};
