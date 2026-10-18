// ---------------------------------------------------------------------------
// Schema mapping: the ONLY file you need to edit to match your DuckDB tables.
//
// The explorer models lineage only; it does not read runs or run events.
// Adjust the table and column names below to whatever your database uses.
//
//   job            one row per job              (namespace, name, optional title, description, archetype)
//   dataset        one row per dataset          (namespace, name, optional title, description, archetype)
//   job_input      datasets a job reads         (job, dataset)
//   job_output     datasets a job writes        (job, dataset)
//   view           one row per table or view a  (view dataset, base dataset)
//                  view is defined over, in the
//                  same database
//   dataset_field  columns of a dataset         (dataset, field name, type, description)
//   column_lineage one row per input field of   (job, input dataset + field,
//                  an output field                output dataset + field,
//                                                 transformation type + subtype)
//
// column_lineage follows the OpenLineage columnLineage facet: each output field
// lists the input fields it derives from, with a transformation type (DIRECT or
// INDIRECT) and subtype (IDENTITY, TRANSFORMATION, AGGREGATION, JOIN, FILTER, ...).
// The job columns may be NULL when the producing job is unknown.
// ---------------------------------------------------------------------------
export const schema = {
  job: { table: 'job', namespace: 'namespace', name: 'name', title: 'title', description: 'description', archetype: 'archetype' },
  dataset: { table: 'dataset', namespace: 'namespace', name: 'name', title: 'title', description: 'description', archetype: 'archetype' },
  input: {
    table: 'job_input',
    jobNamespace: 'job_namespace',
    jobName: 'job_name',
    namespace: 'dataset_namespace',
    name: 'dataset_name',
  },
  output: {
    table: 'job_output',
    jobNamespace: 'job_namespace',
    jobName: 'job_name',
    namespace: 'dataset_namespace',
    name: 'dataset_name',
  },
  view: {
    table: 'view',
    viewNamespace: 'view_namespace',
    viewName: 'view_name',
    baseNamespace: 'base_namespace',
    baseName: 'base_name',
  },
  field: {
    table: 'dataset_field',
    namespace: 'dataset_namespace',
    dataset: 'dataset_name',
    name: 'field_name',
    type: 'field_type',
    description: 'description',
  },
  columnLineage: {
    table: 'column_lineage',
    jobNamespace: 'job_namespace',
    jobName: 'job_name',
    inputNamespace: 'input_dataset_namespace',
    inputDataset: 'input_dataset_name',
    inputField: 'input_field',
    outputNamespace: 'output_dataset_namespace',
    outputDataset: 'output_dataset_name',
    outputField: 'output_field',
    transformationType: 'transformation_type',
    transformationSubtype: 'transformation_subtype',
  },
} as const;
